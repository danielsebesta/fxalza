import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { ProductData } from "../src/alza.ts";

// The cache reads its file when the module loads, so the file is put in place and the environment set before the import.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fxalza-cache-"));
const file = path.join(dir, "cache.json");
process.env.CACHE_FILE = file;
process.env.CACHE_SAVE_DELAY_MS = "20";

function product(id: string, name = `Product ${id}`): ProductData {
  return { id, name, price: 100, priceText: "100 Kč", availability: "InStock", availabilityText: "Skladem", rating: null, ratingCount: null, brand: null, image: null, canonicalUrl: `https://www.alza.cz/-d${id}.htm`, benefits: [], fetchedAt: new Date().toISOString() };
}

fs.writeFileSync(
  file,
  JSON.stringify({
    good: { at: Date.now(), data: product("1") },
    noData: { at: Date.now() },
    wrongShape: "not an entry",
    zeroPrice: { at: Date.now(), data: { ...product("2"), price: 0 } },
  }),
);

const cache = await import("../src/cache.ts");
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const stored = (): Record<string, { data: ProductData }> => JSON.parse(fs.readFileSync(file, "utf8"));

test("damaged entries are skipped on load and the good ones kept", () => {
  assert.equal(cache.cacheSize(), 1);
  assert.equal(cache.getCached("good")?.id, "1");
  assert.equal(cache.getCached("noData"), null);
  assert.equal(cache.getCached("zeroPrice"), null);
});

test("a change made while the file is being written is saved as well", async () => {
  const realWrite = fs.promises.writeFile;
  let writes = 0;
  // the first write is slow, so the second change lands while it is still running
  fs.promises.writeFile = (async (...args: Parameters<typeof realWrite>) => {
    writes++;
    if (writes === 1) await wait(150);
    return realWrite(...args);
  }) as typeof realWrite;
  try {
    cache.putCached("a", product("10"));
    await wait(60); // the save for "a" has started and is sleeping
    cache.putCached("b", product("11"));
    await wait(400);
    const saved = stored();
    assert.equal(saved["a"]?.data.id, "10");
    assert.equal(saved["b"]?.data.id, "11", "the change made during the save must reach the file");
  } finally {
    fs.promises.writeFile = realWrite;
  }
});

test("flushCache writes synchronously and leaves no temporary files behind", () => {
  cache.putCached("c", product("12"));
  cache.flushCache();
  assert.equal(stored()["c"]?.data.id, "12");
  assert.deepEqual(fs.readdirSync(dir), ["cache.json"]);
});
