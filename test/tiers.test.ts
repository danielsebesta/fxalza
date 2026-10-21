import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildBenefits, conditionText, followerTiers, type TierResult } from "../src/alza.ts";

interface Fixture {
  id: string;
  tiers: Record<string, TierResult | null>;
}

const fixtures = JSON.parse(readFileSync(new URL("./fixtures/tiers.json", import.meta.url), "utf8")) as Fixture[];
const present = (f: Fixture): Map<string, TierResult> =>
  new Map(Object.entries(f.tiers).filter((e): e is [string, TierResult] => e[1] !== null));

// Captured from real Alza responses. Silver and Bronze are only requested when Gold has a club
// price, everything else is always requested, so the result has to equal fetching all six tiers.
test("fetching Silver and Bronze only behind a visible Gold gives the same benefits as all six tiers", () => {
  assert.ok(fixtures.length >= 5);
  for (const f of fixtures) {
    const full = present(f);
    const firstRound = new Map([...full].filter(([name]) => name !== "Silver" && name !== "Bronze"));
    for (const name of followerTiers(firstRound)) firstRound.set(name, full.get(name)!);
    assert.deepEqual(buildBenefits(firstRound).entries, buildBenefits(full).entries, `product ${f.id}`);
  }
});

test("ISIC and B2B keep their own prices even when Gold is visible (Huawei MatePad)", () => {
  const f = fixtures.find((x) => x.id === "13028740")!;
  const labels = buildBenefits(present(f)).entries.map((e) => e.label);
  assert.deepEqual(labels, ["B2B", "ISIC", "Gold", "Silver", "Bronze"]);
});

test("club prices show the discount cut to whole percent like the Alza labels", () => {
  const f = fixtures.find((x) => x.id === "13028740")!;
  const shown = Object.fromEntries(buildBenefits(present(f)).entries.map((e) => [e.label, e.percentShown]));
  // Alza: Bronze Sleva -2 %, Silver -5 %, Gold -8 %, B2B -10 %, ISIC -10 %
  assert.deepEqual(shown, { B2B: 10, ISIC: 10, Gold: 8, Silver: 5, Bronze: 2 });
});

test("club discounts are cut, not rounded, and measured from the crossed out price on a sale", () => {
  const price = (amount: number) => ({ amount, promo: false, priceType: null, name: "", coupon: "" });
  const tier = (name: string, amount: number, compare?: number): TierResult => ({
    tier: name,
    hidden: false,
    selected: price(amount),
    main: price(amount),
    promos: [],
    ...(compare ? { compare } : {}),
  });
  const gold = (basic: TierResult, amount: number) =>
    buildBenefits(new Map([["Basic", basic], ["Gold", tier("Gold", amount)]])).entries.find((e) => e.kind === "tier")!.percentShown;
  // 13.9997 % is -13 % on Alza, a half koruna tolerance would have made it 14
  assert.equal(gold(tier("Basic", 3279), 2819.96), 13);
  // Alza counts from the crossed out 309, not from the sale price 279 (16.5 %)
  assert.equal(gold(tier("Basic", 279, 309), 232.96), 24);
  // printed as 729 Kč, but really 728.80 Kč, which is 11.0 % off 819 Kč (10.989 % from the printed price)
  const silver = (basic: TierResult, selected: TierResult) =>
    buildBenefits(new Map([["Basic", basic], ["Silver", selected]])).entries.find((e) => e.kind === "tier")!.percentShown;
  const exact = tier("Silver", 729);
  exact.main!.exact = exact.selected!.exact = 728.8;
  assert.equal(silver(tier("Basic", 819), tier("Silver", 729)), 10);
  assert.equal(silver(tier("Basic", 819), exact), 11);
  // tiers that print the same price but are not the same price stay on separate lines
  const other = tier("Gold", 729);
  other.main!.exact = other.selected!.exact = 729.2;
  const labels = buildBenefits(new Map([["Basic", tier("Basic", 819)], ["Silver", exact], ["Gold", other]])).entries.map((e) => e.label);
  assert.deepEqual(labels, ["Gold", "Silver"]);
});

test("a hidden Gold tier means Silver and Bronze are not requested", () => {
  const f = fixtures.find((x) => x.tiers.Gold?.hidden)!;
  const firstRound = new Map([...present(f)].filter(([name]) => name !== "Silver" && name !== "Bronze"));
  assert.deepEqual(followerTiers(firstRound), []);
});

test("second hand condition comes from JSON-LD and the grade from the stock label", () => {
  const label = (t: string) => `<span class="stcStock avlVal avl2 none" title="${t}">${t}</span>`;
  assert.equal(conditionText("https://schema.org/UsedCondition", label("Rozbaleno - skladem 1 ks")), "Rozbaleno");
  assert.equal(conditionText("https://schema.org/UsedCondition", label("Zánovní - skladem 3 ks")), "Zánovní");
  assert.equal(conditionText("https://schema.org/UsedCondition", label("Použité ")), "Použité");
  assert.equal(conditionText("https://schema.org/UsedCondition", "<html></html>"), "Použité");
  assert.equal(conditionText("https://schema.org/NewCondition", label("Skladem > 5 ks")), null);
  assert.equal(conditionText(undefined, label("Rozbaleno - skladem 1 ks")), null);
});

test("tiers with the very same price share one line in a fixed order, whichever tiers they are", () => {
  const price = (amount: number) => ({ amount, promo: false, priceType: null, name: "", coupon: "" });
  const tier = (name: string, amount: number): TierResult => ({ tier: name, hidden: false, selected: price(amount), main: price(amount), promos: [] });
  const labels = (entries: Record<string, number>): string[] =>
    buildBenefits(new Map([["Basic", tier("Basic", 1000)], ...Object.entries(entries).map(([n, a]) => [n, tier(n, a)] as [string, TierResult])])).entries.map((e) => e.label);
  assert.deepEqual(labels({ Gold: 900, Silver: 950, ISIC: 950, Bronze: 980, B2B: 980 }), ["Gold", "Silver/ISIC", "Bronze"]);
  assert.deepEqual(labels({ Gold: 950, Silver: 950, ISIC: 950, Bronze: 980, B2B: 900 }), ["B2B", "Gold/Silver/ISIC", "Bronze"]);
  assert.deepEqual(labels({ B2B: 970, Bronze: 970, Silver: 970, Gold: 970, ISIC: 970 }), ["Gold/Silver/ISIC/Bronze"]);
  // the B2B group is Bronze plus B2B: hidden when it only repeats Bronze, shown when it differs or stands alone
  assert.deepEqual(labels({ Bronze: 980, B2B: 980 }), ["Bronze"]);
  assert.deepEqual(labels({ Bronze: 980, B2B: 940 }), ["B2B", "Bronze"]);
  assert.deepEqual(labels({ B2B: 940 }), ["B2B"]);
  assert.deepEqual(labels({ Silver: 960, Bronze: 960 }), ["Silver/Bronze"]);
});
