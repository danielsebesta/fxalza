// Samples random products from random Alza categories and stores every tier price for them,
// in the same shape as test/fixtures/tiers.json (plus the category and the url).
//   node scripts/sample-products.ts [categories=100] [perCategory=10] [seed=1]
// Output: data/sample/products.json, written after every category so an aborted run keeps what it has.
import { mkdirSync, writeFileSync } from "node:fs";
import { fetchTier, stopSidecar, TIERS, type TierResult } from "../src/alza.ts";
import { fetchUrl } from "../src/fetcher.ts";

const CATEGORIES = Number(process.argv[2] ?? 100);
const PER_CATEGORY = Number(process.argv[3] ?? 10);
let seed = Number(process.argv[4] ?? 1);
const CONCURRENCY = 2;
const OUT_DIR = new URL("../data/sample/", import.meta.url);

// small deterministic PRNG so a run can be repeated with the same seed
function rnd(): number {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2 ** 32;
}
function sample<T>(items: T[], n: number): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a.slice(0, n);
}

async function pool<T>(items: T[], fn: (x: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < items.length) await fn(items[next++]!);
    }),
  );
}

interface Row {
  id: string;
  category: string;
  url: string;
  tiers: Record<string, TierResult | null>;
}

const sitemap = await fetchUrl("https://www.alza.cz/_sitemap-categories.xml", { timeoutMs: 30000 });
const categories = [...sitemap.body.matchAll(/<loc>([^<]+\/\d+\.htm)<\/loc>/g)].map((m) => m[1]!);
console.log(`${categories.length} categories in the sitemap`);

mkdirSync(OUT_DIR, { recursive: true });
const rows: Row[] = [];
const seen = new Set<string>();
let visited = 0;
let empty = 0;

for (const category of sample(categories, CATEGORIES * 2)) {
  if (visited >= CATEGORIES) break;
  let html = "";
  for (let attempt = 0; attempt < 3 && !html; attempt++) {
    try {
      const res = await fetchUrl(category, { timeoutMs: 30000 });
      if (res.status === 200) html = res.body;
      else console.log(`  ${res.status} ${category}`);
    } catch (e) {
      console.log(`  failed ${category}: ${String(e).slice(0, 120)}`);
    }
    if (!html) await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
  }
  if (!html) continue;
  const links = new Map<string, string>();
  for (const m of html.matchAll(/href="((?:https:\/\/www\.alza\.cz)?\/[a-z0-9-]*-d(\d{6,9})\.htm)"/g)) {
    if (!seen.has(m[2]!)) links.set(m[2]!, m[1]!.replace(/^\//, "https://www.alza.cz/"));
  }
  if (links.size < 3) {
    empty++;
    continue;
  }
  visited++;
  const picked = sample([...links], PER_CATEGORY);
  const batch: Row[] = picked.map(([id, url]) => ({ id, category, url, tiers: {} }));
  await pool(batch, async (row) => {
    seen.add(row.id);
    for (const tier of TIERS) row.tiers[tier.name] = await fetchTier(row.id, tier);
  });
  rows.push(...batch);
  writeFileSync(new URL("products.json", OUT_DIR), JSON.stringify(rows, null, 1));
  console.log(`[${visited}/${CATEGORIES}] ${rows.length} products  ${category}`);
}

console.log(`done: ${rows.length} products from ${visited} categories (${empty} skipped without a product list)`);
await stopSidecar();
process.exit(0);
