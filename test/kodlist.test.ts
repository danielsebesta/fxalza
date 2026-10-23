import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { isKodPath, kodCodes, parseKodList } from "../src/kodlist.ts";

const html = readFileSync(new URL("./fixtures/kod-list.html", import.meta.url), "utf8");

test("reads the order codes from the path", () => {
  assert.deepEqual(kodCodes("/kod/BD740h22b;EFr55s1;GSKILL0041"), ["BD740h22b", "EFr55s1", "GSKILL0041"]);
  assert.deepEqual(kodCodes("/kod/ABC"), ["ABC"]);
  const withUnderscore = "/kod/SAMO0296b2;TEFHF6094;SIEAK86;APW_AWAY_84_42;KRMK1454;CHPto0214";
  assert.equal(isKodPath(withUnderscore), true);
  assert.deepEqual(kodCodes(withUnderscore), ["SAMO0296b2", "TEFHF6094", "SIEAK86", "APW_AWAY_84_42", "KRMK1454", "CHPto0214"]);
  assert.equal(isKodPath("/kod/BD750m5b;ASr97c1"), true);
  assert.equal(isKodPath("/kod/a-b"), true);
  assert.equal(isKodPath("/kod/a.b"), false);
  assert.equal(isKodPath("/kod/a/b"), false);
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

test("a listing keeps the stock word and drops the quantity and the date", () => {
  const row = (id: string, stock: string) =>
    `<div class="box-row"><a class="name js-box-link" href="/x-d${id}.htm">${id}</a><span class="avlVal">${stock}</span></div>`;
  const list = parseKodList(row("1", "Skladem &gt; 5 ks") + row("2", "Na cestě &gt; 5 ks<div class='postfix'>Očekáváme 26.10.2026</div>") + row("3", "Očekáváme 29. října 2026") + row("4", "Není skladem"), 4)!;
  assert.deepEqual(list.items.map((i) => i.availability), ["Skladem", "Na cestě", "Očekáváme", "Není skladem"]);
});

test("parses the raw page, where products are linked relatively", () => {
  const raw = readFileSync(new URL("./fixtures/kod-list-raw.html", import.meta.url), "utf8");
  const list = parseKodList(raw, 8)!;
  assert.equal(list.items.length, 8);
  assert.equal(list.items[0]!.url, "https://www.alza.cz/amd-ryzen-5-9600x-d12482042.htm");
  assert.equal(list.items[0]!.priceText, "4 890 Kč");
  assert.equal(list.items[2]!.wasText, "3 279 Kč");
  assert.equal(list.total, 45576);
  assert.ok(list.items.every((i) => i.availability === "Skladem"));
  assert.ok(list.items.every((i) => i.image?.startsWith("https://image.alza.cz/products/")));
});
