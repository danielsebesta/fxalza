import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseQuantityDiscount, withQuantity, withExactPercents, type BenefitEntry } from "../src/alza.ts";
import { SHOPS, type ShopCode } from "../src/shops.ts";

// the quantity block cut out of the pages as the server sends them (single quoted data attributes), 28 November 2026
const block = (name: string): string => readFileSync(new URL(`./fixtures/quantity-${name}.html`, import.meta.url), "utf8");
const ladder = (name: string, shop: ShopCode): [number, number][] => parseQuantityDiscount(block(name), SHOPS[shop])!.tiers.map((t) => [t.from, t.price]);

test("reads a two step ladder from the real page", () => {
  assert.deepEqual(ladder("cz-two", "cz"), [[1, 139], [2, 108]]);
});

test("reads the ladder of every shop in its own price format", () => {
  assert.deepEqual(ladder("cz", "cz"), [[1, 149], [2, 134], [3, 127]]);
  assert.deepEqual(ladder("sk", "sk"), [[1, 5.29], [2, 4.77], [3, 4.51]]);
  assert.deepEqual(ladder("de", "de"), [[1, 2.78], [2, 2.52], [3, 2.37]]);
  assert.deepEqual(ladder("hu", "hu"), [[1, 2090], [2, 1880], [3, 1780]]);
});

test("a thousands separator is not read as the decimal one", () => {
  const price = (value: string): number | undefined =>
    parseQuantityDiscount(`<div class="quantityRepeater"><div data-cntfrom='1' data-cntto='1'><div class="colLabel">1</div><div class="colValue">${value}</div></div></div>`, SHOPS.de)?.tiers[0]?.price;
  assert.equal(price("1.299,00 €/Packung"), 1299);
  assert.equal(price("€ 1.299,-"), 1299);
  assert.equal(price("1 299,90 €"), 1299.9);
  assert.equal(price("12.499 Ft"), 12499);
  assert.equal(price("1&nbsp;299,-"), 1299);
});

test("no quantity block, no discount", () => {
  assert.equal(parseQuantityDiscount("<html></html>", SHOPS.cz), null);
});

test("withQuantity adds one entry with the ladder and sorts it behind the promos", () => {
  const q = parseQuantityDiscount(block("cz"), SHOPS.cz)!;
  const promo: BenefitEntry = { kind: "promo", label: "Akční cena", price: 140, priceText: "140 Kč", percent: 6, percentShown: 6 };
  const tier: BenefitEntry = { kind: "tier", label: "Gold", price: 130, priceText: "130 Kč", percent: 13, percentShown: 13 };
  const out = withQuantity([tier, promo], q, SHOPS.cz);
  assert.deepEqual(out.map((e) => e.kind), ["promo", "quantity", "tier"]);
  const entry = out.find((e) => e.kind === "quantity")!;
  assert.equal(entry.price, 127);
  assert.equal(entry.priceText, "127 Kč");
  assert.deepEqual(entry.tiers!.map((t) => t.label), ["2 balení", "3 a více balení"]);
});

test("a long ladder keeps its cheapest step", () => {
  const step = (from: number, price: number) => ({ from, label: `${from} ks`, price, priceText: `${price} Kč`, percent: null });
  const long = { text: "", tiers: [step(1, 100), step(2, 95), step(3, 90), step(5, 85), step(10, 70)] };
  assert.deepEqual(withQuantity([], long, SHOPS.cz)[0]!.tiers!.map((t) => t.from), [2, 3, 10]);
});

test("withQuantity leaves the benefits alone without a discount", () => {
  const promo: BenefitEntry = { kind: "promo", label: "Akční cena", price: 140, priceText: "140 Kč", percent: 6, percentShown: 6 };
  assert.deepEqual(withQuantity([promo], null, SHOPS.cz), [promo]);
});

test("the percents of the product JSON replace the ones worked out from rounded prices", () => {
  const q = parseQuantityDiscount(block("cz-two"), SHOPS.cz)!;
  assert.equal(withExactPercents(q, [{ from: 2, percent: 22.14 }])!.tiers[1]!.percent, 22.14);
});

test("the page percent stays without the product JSON or when the two are far apart", () => {
  const q = parseQuantityDiscount(block("cz-two"), SHOPS.cz)!;
  assert.deepEqual(withExactPercents(q, []), q);
  assert.deepEqual(withExactPercents(q, [{ from: 2, percent: 40 }, { from: 3, percent: 22 }]), q);
  assert.equal(withExactPercents(null, []), null);
});
