import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { kodCodes, parseKodList } from "../src/kodlist.ts";

const html = readFileSync(new URL("./fixtures/kod-list.html", import.meta.url), "utf8");

test("reads the order codes from the path", () => {
  assert.deepEqual(kodCodes("/kod/BD740h22b;EFr55s1;GSKILL0041"), ["BD740h22b", "EFr55s1", "GSKILL0041"]);
  assert.deepEqual(kodCodes("/kod/ABC"), ["ABC"]);
});

test("parses the products of a listing", () => {
  const list = parseKodList(html, 7)!;
  assert.equal(list.items.length, 5);
  assert.equal(list.requested, 7);
  assert.deepEqual(list.items.map((i) => i.id), ["7082021", "10676572", "5683232", "7752886", "9874141"]);
  assert.equal(list.items[0]!.name, "AMD Ryzen 5 5600");
  assert.equal(list.items[0]!.url, "https://www.alza.cz/amd-ryzen-5-5600-d7082021.htm");
  assert.equal(list.items[0]!.priceText, "3 190 Kč");
  assert.equal(list.items[1]!.wasText, "1 449 Kč");
  assert.equal(list.total, 3190 + 1433 + 3299 + 3469 + 904);
  assert.equal(list.items[2]!.image, "https://image.alza.cz/products/GSKILL0041/GSKILL0041.jpg");
  assert.ok(list.items.every((i) => i.image?.startsWith("https://image.alza.cz/products/")));
});

test("returns null when the page has no products", () => {
  assert.equal(parseKodList("<html><body>nic</body></html>", 1), null);
});
