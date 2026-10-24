import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ProductData } from "./alza.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// CACHE_FILE puts the file elsewhere (a volume, a temporary folder in tests); the default sits next to the source tree.
const FILE = process.env.CACHE_FILE ? path.resolve(process.env.CACHE_FILE) : path.resolve(__dirname, "../data/cache.json");
const TTL_MS = Number(process.env.CACHE_TTL_MS ?? 24 * 3600 * 1000);
const MAX_STALE_MS = Number(process.env.CACHE_MAX_STALE_MS ?? 7 * 24 * 3600 * 1000);
const PARTIAL_TTL_MS = Number(process.env.CACHE_PARTIAL_TTL_MS ?? 5 * 60_000);
const MAX_ENTRIES = Number(process.env.CACHE_MAX_ENTRIES ?? 5000);
const SAVE_DELAY_MS = Number(process.env.CACHE_SAVE_DELAY_MS ?? 5000);

interface Entry {
  at: number;
  data: ProductData;
}

const mem = new Map<string, Entry>();

// One bad entry must not cost the whole file, so every entry is checked on its own.
function validEntry(v: unknown): v is Entry {
  if (!v || typeof v !== "object") return false;
  const e = v as Partial<Entry>;
  if (typeof e.at !== "number" || !Number.isFinite(e.at)) return false;
  const d = e.data as Partial<ProductData> | undefined;
  return !!d && typeof d === "object" && typeof d.id === "string" && typeof d.name === "string" && d.price !== 0;
}

try {
  const raw = JSON.parse(fs.readFileSync(FILE, "utf8")) as unknown;
  let skipped = 0;
  for (const [k, v] of Object.entries(raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {})) {
    if (validEntry(v)) mem.set(k, v);
    else skipped++;
  }
  console.log(`[cache] loaded ${mem.size} entries from ${FILE}${skipped ? `, skipped ${skipped} damaged` : ""}`);
} catch (e) {
  if ((e as NodeJS.ErrnoException)?.code !== "ENOENT") console.warn(`[cache] ${FILE} not loaded, starting empty: ${e instanceof Error ? e.message : e}`);
}

let dirty = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let saving = false;
let seq = 0;

// Each save writes a temporary file of its own and renames it over the real one, so a reader never sees a half written file and
// a synchronous flush during an asynchronous save does not write into the same temporary file.
function tmpName(): string {
  return `${FILE}.${process.pid}.${++seq}.tmp`;
}

function save(sync = false): void {
  if (!dirty || (saving && !sync)) return;
  dirty = false;
  const json = JSON.stringify(Object.fromEntries(mem));
  const tmp = tmpName();
  if (sync) {
    try {
      fs.mkdirSync(path.dirname(FILE), { recursive: true });
      fs.writeFileSync(tmp, json);
      fs.renameSync(tmp, FILE);
    } catch (e) {
      fs.rmSync(tmp, { force: true });
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
      fs.rmSync(tmp, { force: true });
      console.error("[cache] save failed:", e);
    })
    .finally(() => {
      saving = false;
      // Changes made while the file was being written, or a failed write, get another save; without this they waited for the next change.
      if (dirty) scheduleSave();
    });
}

function scheduleSave(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    save();
  }, SAVE_DELAY_MS);
}

export function flushCache(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  save(true);
}

export function cacheSize(): number {
  return mem.size;
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
