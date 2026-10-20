import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ProductData } from "./alza.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.resolve(__dirname, "../data/cache.json");
const TTL_MS = Number(process.env.CACHE_TTL_MS ?? 24 * 3600 * 1000);
const MAX_STALE_MS = Number(process.env.CACHE_MAX_STALE_MS ?? 7 * 24 * 3600 * 1000);
const PARTIAL_TTL_MS = Number(process.env.CACHE_PARTIAL_TTL_MS ?? 5 * 60_000);
const MAX_ENTRIES = Number(process.env.CACHE_MAX_ENTRIES ?? 5000);

interface Entry {
  at: number;
  data: ProductData;
}

const mem = new Map<string, Entry>();

try {
  const raw = JSON.parse(fs.readFileSync(FILE, "utf8")) as Record<string, Entry>;
  for (const [k, v] of Object.entries(raw)) if (v.data.price !== 0) mem.set(k, v);
  console.log(`[cache] loaded ${mem.size} entries from ${FILE}`);
} catch {
}

let dirty = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

let saving = false;

function save(sync = false): void {
  if (!dirty || (saving && !sync)) return;
  dirty = false;
  const json = JSON.stringify(Object.fromEntries(mem));
  const tmp = `${FILE}.tmp`;
  if (sync) {
    try {
      fs.mkdirSync(path.dirname(FILE), { recursive: true });
      fs.writeFileSync(tmp, json);
      fs.renameSync(tmp, FILE);
    } catch (e) {
      console.error("[cache] save failed:", e);
    }
    return;
  }
  saving = true;
  fs.promises
    .mkdir(path.dirname(FILE), { recursive: true })
    .then(() => fs.promises.writeFile(tmp, json))
    .then(() => fs.promises.rename(tmp, FILE))
    .catch((e) => {
      dirty = true;
      console.error("[cache] save failed:", e);
    })
    .finally(() => {
      saving = false;
    });
}

function scheduleSave(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    save();
  }, 5000);
}

export function flushCache(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  save(true);
}

type CacheState = "fresh" | "stale" | "expired";

export function peekCached(id: string): { data: ProductData; state: CacheState } | null {
  const e = mem.get(id);
  if (!e) return null;
  mem.delete(id);
  mem.set(id, e);
  const age = Date.now() - e.at;
  const ttl = e.data.partial ? Math.min(TTL_MS, PARTIAL_TTL_MS) : TTL_MS;
  return { data: e.data, state: age <= ttl ? "fresh" : age <= MAX_STALE_MS ? "stale" : "expired" };
}

export function getCached(id: string, allowStale = false): ProductData | null {
  const e = peekCached(id);
  if (!e) return null;
  return allowStale || e.state === "fresh" ? e.data : null;
}

export function putCached(id: string, data: ProductData): void {
  mem.delete(id);
  mem.set(id, { at: Date.now(), data });
  while (mem.size > MAX_ENTRIES) mem.delete(mem.keys().next().value!);
  dirty = true;
  scheduleSave();
}
