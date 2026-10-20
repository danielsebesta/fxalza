import { Sidecar } from "./sidecar.ts";

export interface FetchResult {
  status: number;
  body: string;
  via: string;
}

interface FetchOpts {
  headers?: Record<string, string>;
  timeoutMs?: number;
  prefer?: string[];
}

interface Provider {
  name: string;
  enabled: () => boolean;
  run: (url: string, opts: FetchOpts, timeoutMs: number) => Promise<{ status: number; body: string }>;
}

const COOLDOWN_MS = Number(process.env.FETCH_COOLDOWN_MS ?? 60_000);
const SIDECAR_COOLDOWN_MS = Number(process.env.SIDECAR_COOLDOWN_MS ?? 10_000);
const PAID_MIN_TIMEOUT_MS = 20_000;
const sidecar = new Sidecar();

class KeyPool {
  private name: string;
  private keys: string[];
  private downUntil = new Map<string, number>();
  private cursor = 0;

  constructor(name: string, raw: string | undefined) {
    this.name = name;
    this.keys = [...new Set((raw ?? "").split(/[\s,;]+/).filter(Boolean))];
  }

  available(): boolean {
    return this.keys.some((k) => (this.downUntil.get(k) ?? 0) <= Date.now());
  }

  private pick(tried: Set<string>): string | null {
    for (let i = 0; i < this.keys.length; i++) {
      const key = this.keys[(this.cursor + i) % this.keys.length]!;
      if (tried.has(key) || (this.downUntil.get(key) ?? 0) > Date.now()) continue;
      this.cursor = (this.cursor + i + 1) % this.keys.length;
      return key;
    }
    return null;
  }

  async run(attempt: (key: string) => Promise<{ status: number; body: string }>): Promise<{ status: number; body: string }> {
    const tried = new Set<string>();
    let last: { status: number; body: string } | null = null;
    for (let key = this.pick(tried); key; key = this.pick(tried)) {
      tried.add(key);
      const n = this.keys.indexOf(key) + 1;
      try {
        const r = await attempt(key);
        if (r.status === 401 || r.status === 402 || r.status === 429) {
          this.down(key, n, r.status);
          last = r;
          continue;
        }
        return r;
      } catch (e) {
        const status = e instanceof KeyError ? e.status : 0;
        if (status === 401 || status === 402 || status === 429) {
          this.down(key, n, status);
          continue;
        }
        throw e;
      }
    }
    if (last) return last;
    throw new Error(this.name + ": no usable key");
  }

  private down(key: string, n: number, status: number): void {
    const ms = status === 429 ? 60_000 : 3_600_000;
    this.downUntil.set(key, Date.now() + ms);
    console.warn(`[keys] ${this.name} key #${n} rejected (HTTP ${status}), paused for ${ms / 60_000} min`);
  }
}

class KeyError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const brightdata = new KeyPool("brightdata", process.env.BRIGHTDATA_KEY);
const scrapedo = new KeyPool("scrape.do", process.env.SCRAPEDO_TOKEN);
const firecrawl = new KeyPool("firecrawl", process.env.FIRECRAWL_KEY);

export function stopSidecar(): void {
  sidecar.stop();
}

const providers: Provider[] = [
  {
    name: "sidecar",
    enabled: () => process.env.SIDECAR_DISABLED !== "1",
    async run(url, opts, timeoutMs) {
      const res = await sidecar.request(url, { headers: opts.headers, timeoutMs });
      if (res.error) throw new Error(res.error);
      return { status: res.status, body: Buffer.from(res.body, "base64").toString("utf8") };
    },
  },
  {
    name: "brightdata",
    enabled: () => brightdata.available(),
    run: (url, _opts, timeoutMs) =>
      brightdata.run(async (key) => {
        const res = await fetch("https://api.brightdata.com/request", {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            zone: process.env.BRIGHTDATA_ZONE ?? "web_unlocker1",
            url,
            format: "raw",
            country: "cz",
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });
        return { status: res.status, body: await res.text() };
      }),
  },
  {
    name: "scrape.do",
    enabled: () => scrapedo.available(),
    run: (url, _opts, timeoutMs) =>
      scrapedo.run(async (key) => {
        const api = `https://api.scrape.do/?token=${key}&url=${encodeURIComponent(url)}&super=true&geoCode=cz`;
        const res = await fetch(api, { signal: AbortSignal.timeout(timeoutMs) });
        return { status: res.status, body: await res.text() };
      }),
  },
  {
    name: "firecrawl",
    enabled: () => firecrawl.available(),
    run: (url, _opts, timeoutMs) =>
      firecrawl.run(async (key) => {
        const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({ url, formats: ["rawHtml"], location: { country: "CZ" }, timeout: timeoutMs }),
          signal: AbortSignal.timeout(timeoutMs + 5000),
        });
        const j = (await res.json()) as { success?: boolean; data?: { rawHtml?: string; metadata?: { statusCode?: number } } };
        if (!res.ok || !j.success) throw new KeyError(`firecrawl HTTP ${res.status}`, res.status);
        return { status: j.data?.metadata?.statusCode ?? 200, body: j.data?.rawHtml ?? "" };
      }),
  },
];

const downUntil = new Map<string, number>();

function usable(status: number, body: string): boolean {
  if (status === 401 || status === 402 || status === 403 || status === 429 || status >= 500) return false;
  if (status === 200 && /<title>\s*Just a moment/i.test(body.slice(0, 4000))) return false;
  return true;
}

export async function fetchUrl(url: string, opts: FetchOpts = {}): Promise<FetchResult> {
  const timeoutMs = opts.timeoutMs ?? 25_000;
  const errors: string[] = [];
  let last: FetchResult | null = null;

  const order = providers
    .map((p, i) => ({ p, rank: p.name === "sidecar" ? -2 : (opts.prefer?.indexOf(p.name) ?? -1) >= 0 ? -1 : i }))
    .sort((a, b) => a.rank - b.rank || (opts.prefer?.indexOf(a.p.name) ?? 0) - (opts.prefer?.indexOf(b.p.name) ?? 0))
    .map((x) => x.p);

  for (const p of order) {
    if (!p.enabled()) continue;
    if ((downUntil.get(p.name) ?? 0) > Date.now()) continue;
    const t = p.name === "sidecar" ? timeoutMs : Math.max(timeoutMs, PAID_MIN_TIMEOUT_MS);
    const started = Date.now();
    try {
      const r = await p.run(url, opts, t);
      if (usable(r.status, r.body)) {
        console.log(`[fetch] ${p.name} ${r.status} ${Date.now() - started}ms ${new URL(url).pathname}${new URL(url).search}`);
        return { ...r, via: p.name };
      }
      last = { ...r, via: p.name };
      errors.push(`${p.name}: HTTP ${r.status}`);
    } catch (e) {
      errors.push(`${p.name}: ${e instanceof Error ? e.message : e}`);
    }
    downUntil.set(p.name, Date.now() + (p.name === "sidecar" ? SIDECAR_COOLDOWN_MS : COOLDOWN_MS));
    console.warn(`[fetch] ${p.name} failed for ${url} (${errors[errors.length - 1]}), trying next`);
  }

  if (last) {
    console.warn(`[fetch] no usable response, returning ${last.via} HTTP ${last.status} for ${new URL(url).pathname}${new URL(url).search}`);
    return last;
  }
  throw new Error(`all fetch providers failed: ${errors.join("; ") || "no provider available (disabled or cooling down)"}`);
}
