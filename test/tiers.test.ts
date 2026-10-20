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

test("club prices show the discount rounded to whole percent", () => {
  const f = fixtures.find((x) => x.id === "13028740")!;
  const shown = Object.fromEntries(buildBenefits(present(f)).entries.map((e) => [e.label, e.percentShown]));
  assert.deepEqual(shown, { B2B: 11, ISIC: 10, Gold: 9, Silver: 6, Bronze: 3 });
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
