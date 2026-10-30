import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { availabilityKey, buildBenefits, conditionText, followerTiers, type TierResult } from "../src/alza.ts";
import { texts } from "../src/i18n.ts";
import { SHOPS } from "../src/shops.ts";

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

test("an incoming shipment stays on the way when schema.org calls it in stock", () => {
  const label = (t: string) => `<span class="stcStock avlVal avl1 none" title="${t}">${t}</span>`;
  const schema = "https://schema.org/InStock";
  assert.equal(availabilityKey(schema, label("Na cestě > 5 ks"), SHOPS.cz), "OnTheWay");
  assert.equal(availabilityKey(schema, label("Na ceste > 5 ks"), SHOPS.sk), "OnTheWay");
  assert.equal(availabilityKey(schema, label("Úton > 5 db"), SHOPS.hu), "OnTheWay");
  assert.equal(availabilityKey(schema, label("Unterwegs > 5 Stk."), SHOPS.de), "OnTheWay");
  assert.equal(availabilityKey(schema, label("Unterwegs > 5 Stk."), SHOPS.at), "OnTheWay");
  assert.equal(availabilityKey(schema, label("Skladem > 5 ks"), SHOPS.cz), "InStock");
  assert.equal(availabilityKey(schema, label("Na cestě > 5 ks"), SHOPS.sk), "InStock");
  assert.equal(availabilityKey("https://schema.org/OutOfStock", "<html></html>", SHOPS.cz), "OutOfStock");
  assert.equal(availabilityKey(undefined, "<html></html>"), "unknown");
});

test("stock at the supplier is told apart from stock at Alza", () => {
  const label = (t: string) => `<span class="stcStock avlVal avl0 none" title="${t}">${t}</span>`;
  const schema = "https://schema.org/InStock";
  assert.equal(availabilityKey(schema, label("Skladem u dodavatele"), SHOPS.cz), "SupplierStock");
  assert.equal(availabilityKey(schema, label("Skladom u dodávateľa"), SHOPS.sk), "SupplierStock");
  assert.equal(availabilityKey(schema, label("Skladem > 5 ks"), SHOPS.cz), "InStock");
  assert.equal(availabilityKey(schema, label("Není skladem u dodavatele"), SHOPS.cz), "OutOfStock");
});

test("Alza's Discontinued schema is temporary unavailability unless the page says the sale ended", () => {
  const label = (t: string) => `<span class="stcStock avlVal avl0 none" title="${t}">${t}</span>`;
  const schema = "https://schema.org/Discontinued";
  assert.equal(availabilityKey(schema, "<html></html>", SHOPS.cz), "TemporarilyUnavailable");
  assert.equal(availabilityKey(schema, label("Momentálně nedostupné"), SHOPS.cz), "TemporarilyUnavailable");
  assert.equal(availabilityKey(schema, label("Prodej skončil"), SHOPS.cz), "Discontinued");
  assert.equal(availabilityKey(schema, label("Momentálne nedostupné"), SHOPS.sk), "TemporarilyUnavailable");
  assert.equal(availabilityKey(schema, label("Predaj skončil"), SHOPS.sk), "Discontinued");
  assert.equal(texts("cs").availability.TemporarilyUnavailable, "Momentálně nedostupné");
  assert.equal(texts("cs").availability.Discontinued, "Prodej skončil");
  assert.equal(texts("sk").availability.TemporarilyUnavailable, "Momentálne nedostupné");
});

test("an expected date and a piece count are not part of the status", () => {
  const label = (t: string) => `<span class="stcStock avlVal avl4 none" title="${t}">${t}</span>`;
  const schema = "https://schema.org/PreOrder";
  assert.equal(availabilityKey(schema, label("Očekáváme 29. října 2026"), SHOPS.cz), "Expected");
  assert.equal(availabilityKey(schema, label("Očekáváme 26.10.2026"), SHOPS.cz), "Expected");
  assert.equal(availabilityKey("https://schema.org/InStock", label("Očekáváme 29. října 2026"), SHOPS.cz), "Expected");
  assert.equal(availabilityKey(schema, label("Očakávame 29. októbra 2026"), SHOPS.sk), "Expected");
  assert.equal(availabilityKey(schema, label("Várható időpont: október 29, 2026"), SHOPS.hu), "Expected");
  assert.equal(availabilityKey(schema, label("Erwartet: 29. Oktober 2026"), SHOPS.de), "Expected");
  assert.equal(availabilityKey(schema, label("Erwartet: 29. Oktober 2026"), SHOPS.at), "Expected");
  assert.equal(availabilityKey(schema, label("Očekáváme 29. října 2026"), SHOPS.sk), "PreOrder");
  assert.equal(availabilityKey(schema, label("Očakávame 29. októbra 2026"), SHOPS.cz), "PreOrder");
  assert.equal(texts("cs").availability.Expected, "Očekáváme");
  assert.equal(texts("sk").availability.Expected, "Očakávame");
  assert.equal(texts("hu").availability.Expected, "Várható");
  assert.equal(texts("de").availability.Expected, "Erwartet");
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
