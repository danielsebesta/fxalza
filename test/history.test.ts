import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { fetchPriceHistory, historyLine, parseHistory, type PriceHistory } from "../src/history.ts";
import { CZ, SHOPS } from "../src/shops.ts";

const day = (i: number): string => new Date(Date.UTC(2026, 0, 1 + i)).toISOString();
const series = (prices: (number | null)[]) => prices.map((y, i) => ({ x: day(i), y }));

const history = (over: Partial<PriceHistory> = {}): PriceHistory => ({
  reference: 1000,
  referenceKind: "usual",
  lowest: { price: 800, date: "2026-04-17" },
  days: 365,
  ...over,
});

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

test("the answer of the API is kept as a summary, with the last day of the lowest price", () => {
  const prices = [...Array<number>(40).fill(1000), 800, 900, 800, null, 1000];
  assert.deepEqual(parseHistory({ metadata: { type: "common-price", commonPrice: 1000 }, data: { currentPrice: series(prices), originalPrice: series(prices) } }), {
    reference: 1000,
    referenceKind: "usual",
    lowest: { price: 800, date: day(42).slice(0, 10) },
    days: 44,
  });
});

test("after a recent price drop the reference is the lowest price of the 30 days before it", () => {
  const h = parseHistory({ metadata: { type: "eu-minimum", minPrice: 34990 }, data: { currentPrice: series(Array<number>(40).fill(34990)) } });
  assert.equal(h?.referenceKind, "beforeSale");
  assert.equal(h?.reference, 34990);
});

test("a short series says nothing about the lowest price", () => {
  const h = parseHistory({ metadata: { type: "common-price", commonPrice: 1148 }, data: { currentPrice: series(Array<number>(25).fill(1148)) } });
  assert.equal(h?.lowest, null);
  assert.equal(h?.days, 25);
});

test("nothing usable is no history, whatever came back", () => {
  for (const raw of [null, undefined, 1, "x", [], {}, { error: "Data not found" }, { metadata: {}, data: {} }, { metadata: { commonPrice: "1000" }, data: { currentPrice: "x" } }, { metadata: { commonPrice: -5 }, data: { currentPrice: [null, 1, { x: 1, y: 1 }, { x: "nope", y: 1 }] } }]) {
    assert.equal(parseHistory(raw), null, JSON.stringify(raw));
  }
});

test("the line compares the price of the embed with the usual one and names the lowest of the year", () => {
  const line = (price: number | null, over: Partial<PriceHistory> = {}) => historyLine(history(over), CZ, price);
  assert.equal(line(900), "Hlídač shopů: běžně 1 000 Kč (teď −10 %), za rok nejníž 800 Kč (17. 4. 2026)");
  assert.equal(line(1540), "Hlídač shopů: běžně 1 000 Kč (teď +54 %), za rok nejníž 800 Kč (17. 4. 2026)");
  assert.equal(line(1000), "Hlídač shopů: běžně 1 000 Kč, za rok nejníž 800 Kč (17. 4. 2026)");
  // a difference that rounds to nothing is not one
  assert.equal(line(1003), "Hlídač shopů: běžně 1 000 Kč, za rok nejníž 800 Kč (17. 4. 2026)");
  assert.equal(line(null), "Hlídač shopů: běžně 1 000 Kč, za rok nejníž 800 Kč (17. 4. 2026)");
});

test("a price at the lowest of the year says so, unless it never moved", () => {
  assert.equal(historyLine(history(), CZ, 800), "Hlídač shopů: běžně 1 000 Kč (teď −20 %, nejníž za rok)");
  assert.equal(historyLine(history(), CZ, 349), "Hlídač shopů: běžně 1 000 Kč (teď −65 %, nejníž za rok)");
  assert.equal(historyLine(history({ reference: 499, lowest: { price: 499, date: "2026-10-31" } }), CZ, 499), "Hlídač shopů: běžně 499 Kč");
});

test("a lowest price that adds nothing to the usual one is left out", () => {
  // the usual price comes from a longer window than the series and can be below everything in it
  assert.equal(historyLine(history({ reference: 839, lowest: { price: 849, date: "2025-11-07" } }), CZ, 859), "Hlídač shopů: běžně 839 Kč (teď +2 %)");
  assert.equal(historyLine(history({ reference: 259, lowest: { price: 259, date: "2025-11-19" } }), CZ, 399), "Hlídač shopů: běžně 259 Kč (teď +54 %)");
});

test("a sale is measured against the price before it, a short series names its length", () => {
  assert.equal(historyLine(history({ referenceKind: "beforeSale", reference: 34990, lowest: { price: 31990, date: "2026-10-31" } }), CZ, 31990), "Hlídač shopů: před slevou 34 990 Kč (teď −9 %, nejníž za rok)");
  assert.equal(historyLine(history({ days: 72, lowest: { price: 800, date: "2026-09-21" } }), CZ, 900), "Hlídač shopů: běžně 1 000 Kč (teď −10 %), za 72 dní nejníž 800 Kč (21. 9. 2026)");
  assert.equal(historyLine(history({ reference: null }), CZ, 900), "Hlídač shopů: za rok nejníž 800 Kč (17. 4. 2026)");
  assert.equal(historyLine(history({ days: 25, lowest: null }), CZ, 349), "Hlídač shopů: běžně 1 000 Kč (teď −65 %)");
  assert.equal(historyLine(history({ reference: null, lowest: null }), CZ, 349), null);
});

test("the line is in the language and the currency of the shop, in bold for Discord", () => {
  assert.equal(historyLine(history({ reference: 103, lowest: { price: 88.5, date: "2026-07-20" } }), SHOPS.sk, 112), "Hlídač shopů: bežne 103 € (teraz +9 %), za rok najnižšie 88,50 € (20. 7. 2026)");
  assert.equal(historyLine(history({ referenceKind: "beforeSale", lowest: null }), SHOPS.sk, 900), "Hlídač shopů: pred zľavou 1 000 € (teraz −10 %)");
  assert.equal(historyLine(history(), CZ, 900, true), "Hlídač shopů: běžně **1 000 Kč** (teď −10 %), za rok nejníž **800 Kč** (17. 4. 2026)");
  // no text for a shop Hlídač shopů does not follow
  assert.equal(historyLine(history(), SHOPS.hu, 900), null);
});

test("a shop Hlídač shopů does not follow costs no request", async () => {
  globalThis.fetch = () => assert.fail("no request expected");
  for (const shop of [SHOPS.hu, SHOPS.de, SHOPS.at]) assert.equal(await fetchPriceHistory(shop, "123"), null, shop.code);
});

test("the API is asked by the id of the product, with no slug and nothing of the visitor", async () => {
  let asked = "";
  globalThis.fetch = (async (url: string) => {
    asked = url;
    return Response.json({ metadata: { type: "common-price", commonPrice: 1000 }, data: { currentPrice: [] } });
  }) as typeof fetch;
  assert.equal((await fetchPriceHistory(SHOPS.sk, "123"))?.reference, 1000);
  assert.equal(asked, "https://api.hlidacshopu.cz/v2/detail?url=https%3A%2F%2Fwww.alza.sk%2F-d123.htm");
});

test("a failure of the API only leaves the line out", async () => {
  const answers: (() => Promise<Response>)[] = [
    async () => Response.json({ error: "Data not found" }, { status: 404 }),
    async () => new Response("oops", { status: 500 }),
    async () => new Response("<html>not json</html>"),
    async () => new Response("x".repeat(300 * 1024)),
    async () => {
      throw new TypeError("fetch failed");
    },
    async () => {
      throw new DOMException("timed out", "TimeoutError");
    },
  ];
  for (const answer of answers) {
    globalThis.fetch = answer as typeof fetch;
    assert.equal(await fetchPriceHistory(CZ, "123"), null);
  }
});
