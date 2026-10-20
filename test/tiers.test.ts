import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildBenefits, expandLeanTiers, type TierResult } from "../src/alza.ts";

interface Fixture {
  id: string;
  tiers: Record<string, TierResult | null>;
}

const fixtures = JSON.parse(readFileSync(new URL("./fixtures/tiers.json", import.meta.url), "utf8")) as Fixture[];

// Captured from real Alza responses. Silver and Bronze are not fetched, they are copied from
// ISIC and B2B, so the result has to equal what fetching all six tiers would have produced.
test("copying Silver/Bronze from ISIC/B2B gives the same benefits as fetching every tier", () => {
  assert.ok(fixtures.length >= 4);
  for (const f of fixtures) {
    const full = new Map(Object.entries(f.tiers).filter((e): e is [string, TierResult] => e[1] !== null));
    const lean = new Map([...full].filter(([name]) => name !== "Silver" && name !== "Bronze"));
    assert.deepEqual(buildBenefits(expandLeanTiers(lean)).entries, buildBenefits(full).entries, `product ${f.id}`);
  }
});

test("a hidden Gold tier means no copied Silver or Bronze", () => {
  const f = fixtures.find((x) => x.tiers.Gold?.hidden)!;
  const lean = new Map(Object.entries(f.tiers).filter((e): e is [string, TierResult] => e[1] !== null && e[0] !== "Silver" && e[0] !== "Bronze"));
  const expanded = expandLeanTiers(lean);
  assert.equal(expanded.has("Silver"), false);
  assert.equal(expanded.has("Bronze"), false);
});

test("second hand condition comes from JSON-LD and the grade from the stock label", async () => {
  const { conditionText } = await import("../src/alza.ts");
  const label = (t: string) => `<span class="stcStock avlVal avl2 none" title="${t}">${t}</span>`;
  assert.equal(conditionText("https://schema.org/UsedCondition", label("Rozbaleno - skladem 1 ks")), "Rozbaleno");
  assert.equal(conditionText("https://schema.org/UsedCondition", label("Zánovní - skladem 3 ks")), "Zánovní");
  assert.equal(conditionText("https://schema.org/UsedCondition", label("Použité ")), "Použité");
  assert.equal(conditionText("https://schema.org/UsedCondition", "<html></html>"), "Použité");
  assert.equal(conditionText("https://schema.org/NewCondition", label("Skladem > 5 ks")), null);
  assert.equal(conditionText(undefined, label("Rozbaleno - skladem 1 ks")), null);
});
