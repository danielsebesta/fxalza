// Fetches the current price of every sampled product (data/sample/products.json) in every known price list
// and stores it with Alza's own label in data/sample/prices.json. products.json itself is never changed.
//   node scripts/refresh-sample.ts [--fresh]
// Resumable: products already in prices.json with no failed price list are skipped, --fresh starts over.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { stopSidecar } from "../src/alza.ts";
import { fetchUrl } from "../src/fetcher.ts";

const PRICE_LISTS: Record<string, string> = {
  Basic: "p__26752",
  Bronze: "p_pg5_44266",
  Silver: "p_pg3_36eef",
  Gold: "p_pg4_e6c95",
  ISIC: "p_pg3is1_2b2fc",
  B2B: "p_pg6_6ce49",
  "Gold+B2B": "p_pg2_a25f3",
  "Silver+B2B": "p_pg1cd1_af922",
  "Gold+ISIC": "p_pg4is1_24abf",
  "Bronze+ISIC": "p_pg5is1_16aa0",
};
const CONCURRENCY = 3;
const SAVE_EVERY = 25;
const PRODUCTS = new URL("../data/sample/products.json", import.meta.url);
const OUT = new URL("../data/sample/prices.json", import.meta.url);

interface PriceEntry {
  price: number | null;
  priceText: string | null;
  label: string | null;
  groupType: number | null;
  priceType: number | null;
  compare: string | null;
  promos: { priceText: string; name: string | null; coupon: string | null; priceType: number | null }[];
}
interface Snapshot {
  id: string;
  category: string;
  url: string;
  fetchedAt: string;
  prices: Record<string, PriceEntry | null>;
}

async function fetchPriceList(id: string, pgrik: string): Promise<PriceEntry | null> {
  const url = `https://webapi.alza.cz/api/commodity/v1/${id}/detailPriceInfoV3?country=CZ&pgrik=${pgrik}&ucik=null`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetchUrl(url, { headers: { Accept: "application/json, text/html;q=0.9" }, timeoutMs: 15000, prefer: ["firecrawl"] });
      if (res.status === 200) {
        const body = JSON.parse(res.body);
        const main = body.mainPriceTag;
        if (!main) return null;
        const promos = Array.isArray(body.promoPrices) ? body.promoPrices : [];
        return {
          price: typeof main.primaryPriceNoCurrency === "number" ? main.primaryPriceNoCurrency : null,
          priceText: main.primaryPrice ?? null,
          label: main.headerText ?? null,
          groupType: main.priceGroupType ?? null,
          priceType: main.priceType ?? null,
          compare: main.comparePrice ?? null,
          promos: promos.map((p: any) => ({
            priceText: String(p.primaryPrice ?? ""),
            name: p.name ?? null,
            coupon: p.discountCouponCode ?? null,
            priceType: p.priceType ?? null,
          })),
        };
      }
    } catch {
      // retry below
    }
    await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
  }
  return null;
}

const products = JSON.parse(readFileSync(PRODUCTS, "utf8")) as { id: string; category: string; url: string }[];
const done = new Map<string, Snapshot>();
if (!process.argv.includes("--fresh") && existsSync(OUT)) {
  for (const r of JSON.parse(readFileSync(OUT, "utf8")) as Snapshot[]) done.set(r.id, r);
}
const todo = products.filter((p) => {
  const r = done.get(p.id);
  return !r || Object.keys(PRICE_LISTS).some((n) => r.prices[n] === null || r.prices[n] === undefined);
});
console.log(`${products.length} products, ${todo.length} to fetch`);

const save = () => writeFileSync(OUT, JSON.stringify([...done.values()], null, 1));
let next = 0;
let finished = 0;
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (next < todo.length) {
      const p = todo[next++]!;
      const prices: Record<string, PriceEntry | null> = {};
      for (const [name, pgrik] of Object.entries(PRICE_LISTS)) prices[name] = await fetchPriceList(p.id, pgrik);
      done.set(p.id, { id: p.id, category: p.category, url: p.url, fetchedAt: new Date().toISOString(), prices });
      if (++finished % SAVE_EVERY === 0) {
        save();
        console.log(`${finished}/${todo.length}`);
      }
    }
  }),
);
save();
const failed = [...done.values()].filter((r) => Object.values(r.prices).some((v) => v === null)).length;
console.log(`done: ${done.size} products saved, ${failed} with at least one price list missing`);
await stopSidecar();
process.exit(0);
