import { track } from "./analytics.ts";
import { browserbaseEnabled, browserbaseRun, stopBrowserbase } from "./browserbase.ts";
import { OverloadedError, Sidecar, type SidecarStats } from "./sidecar.ts";

export interface FetchResult {
  status: number;
  body: string;
  via: string;
}

export interface FetchOpts {
  headers?: Record<string, string>;
  timeoutMs?: number;
  prefer?: string[];
  // the country the request should come from where a provider can choose, the shop's own
  country?: string;
}

export interface Provider {
  name: string;
  enabled: () => boolean;
  // costs nothing per request, so it is not counted against the paid budget and is not left out for long after a failure
  free?: boolean;
  // signal fires when another provider already answered, so a hedged request that lost can let go of its connection
  run: (url: string, opts: FetchOpts, timeoutMs: number, signal: AbortSignal) => Promise<{ status: number; body: string }>;
}

const COOLDOWN_MS = Number(process.env.FETCH_COOLDOWN_MS ?? 60_000);
const SIDECAR_COOLDOWN_MS = Number(process.env.SIDECAR_COOLDOWN_MS ?? 10_000);
const PAID_MIN_TIMEOUT_MS = 20_000;
const HEDGE_MS = Number(process.env.FETCH_HEDGE_MS ?? 2500);
const PAID_DAILY_MAX = Number(process.env.PAID_DAILY_MAX ?? 300);
let paidDay = "";
let paidUsed = 0;

function paidBudgetLeft(): boolean {
  const day = new Date().toISOString().slice(0, 10);
  if (day !== paidDay) {
    paidDay = day;
    paidUsed = 0;
  }
  return paidUsed < PAID_DAILY_MAX;
}
const sidecar = new Sidecar();

export function sidecarStats(): SidecarStats {
  return sidecar.stats();
}

const MAX_BODY_BYTES = Number(process.env.FETCH_MAX_BODY_BYTES ?? 8 * 1024 * 1024);

// Reads a response body up to `max` bytes and fails beyond that, so an upstream answering with far more than a page cannot
// fill the memory of the process; res.text() has no such limit. The sidecar applies the same cap on its side.
export async function readBodyCapped(res: Response, max = MAX_BODY_BYTES): Promise<string> {
  const declared = Number(res.headers.get("content-length"));
  if (declared > max) {
    await res.body?.cancel().catch(() => {});
    throw new Error(`response of ${declared} bytes is over the ${max} byte limit`);
  }
  if (!res.body) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      throw new Error(`response is over the ${max} byte limit`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

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

  async run(attempt: (key: string) => Promise<{ status: number; body: string }>, signal?: AbortSignal): Promise<{ status: number; body: string }> {
    const tried = new Set<string>();
    let last: { status: number; body: string } | null = null;
    for (let key = this.pick(tried); key; key = this.pick(tried)) {
      if (signal?.aborted) throw signal.reason;
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
  stopBrowserbase();
}

// The request gives up at its own timeout or as soon as another provider has won, whichever comes first.
function paidSignal(timeoutMs: number, signal: AbortSignal): AbortSignal {
  return AbortSignal.any([AbortSignal.timeout(timeoutMs), signal]);
}

// A 403 that survives the retry means Alza has blocked the sidecar's session. For a while it is left out and Firecrawl goes first
// among the paid providers, so the requests of one product do not each spend their time on a sidecar that is going to fail.
// Each block that follows straight after the last one is twice as long, up to the maximum, and one answer from the sidecar resets it.
const SIDECAR_BLOCK_MS = Number(process.env.SIDECAR_BLOCK_MS ?? 15_000);
const SIDECAR_BLOCK_MAX_MS = Number(process.env.SIDECAR_BLOCK_MAX_MS ?? 5 * 60_000);
let sidecarBlockedUntil = 0;
let sidecarBlockMs = 0;
// Workers of our own on Cloudflare (see worker/), "url|token" separated by commas, the first one is the primary. The addresses are
// kept in the environment only: they are not in the repository and no response or log line carries them.
interface CfWorker {
  name: string;
  url: string;
  token: string;
}
export function parseCfWorkers(raw: string | undefined): CfWorker[] {
  return (raw ?? "")
    .split(",")
    .map((x) => x.trim().split("|"))
    .filter(([url, token]) => /^https:\/\//.test(url ?? "") && !!token)
    .map(([url, token], i) => ({ name: i === 0 ? "cfworker" : `cfworker${i + 1}`, url: url!.replace(/\/$/, ""), token: token! }));
}
const cfWorkers = parseCfWorkers(process.env.CF_WORKERS);
const sidecarBlocked = (): boolean => sidecarBlockedUntil > Date.now() && (cfWorkers.length > 0 || firecrawl.available());

const providers: Provider[] = [
  {
    name: "sidecar",
    enabled: () => process.env.SIDECAR_DISABLED !== "1",
    async run(url, opts, timeoutMs) {
      let res = await sidecar.request(url, { headers: opts.headers, timeoutMs });
      if (!res.error && res.status === 403 && sidecarBlockMs === 0) {
        // a fresh session sometimes gets a one-off 403, a second try is cheaper than a paid fallback
        await new Promise((resolve) => setTimeout(resolve, 300));
        const again = await sidecar.request(url, { headers: opts.headers, timeoutMs });
        console.log(`[fetch] sidecar 403 retried -> ${again.error ? "error" : again.status} ${new URL(url).pathname}`);
        res = again;
      }
      if (!res.error && res.status === 403) {
        // the requests of one product start together, so only the first of them to fail counts
        if (sidecarBlockedUntil <= Date.now()) {
          sidecarBlockMs = Math.min(sidecarBlockMs ? sidecarBlockMs * 2 : SIDECAR_BLOCK_MS, SIDECAR_BLOCK_MAX_MS);
          sidecarBlockedUntil = Date.now() + sidecarBlockMs;
        }
      } else if (!res.error && res.status < 400) sidecarBlockMs = 0;
      if (res.error) throw new Error(res.error);
      if (res.truncated) throw new Error(`sidecar: response larger than the sidecar passes on (HTTP ${res.status})`);
      return { status: res.status, body: Buffer.from(res.body, "base64").toString("utf8") };
    },
  },
  ...cfWorkers.map(
    (w): Provider => ({
      // Asks Alza from Cloudflare's network, which lets that through without a challenge.
      name: w.name,
      free: true,
      enabled: () => true,
      async run(url, opts, timeoutMs, signal) {
        const res = await fetch(`${w.url}/?url=${encodeURIComponent(url)}`, {
          headers: { "x-token": w.token, ...(opts.headers?.Accept ? { accept: opts.headers.Accept } : {}) },
          signal: paidSignal(timeoutMs, signal),
        });
        const body = await readBodyCapped(res);
        if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
        const upstream = Number(res.headers.get("x-upstream-status")) || 502;
        return { status: res.headers.get("x-cf-mitigated") ? 403 : upstream, body };
      },
    }),
  ),
  {
    name: "brightdata",
    enabled: () => brightdata.available(),
    run: (url, opts, timeoutMs, signal) =>
      brightdata.run(async (key) => {
        const res = await fetch("https://api.brightdata.com/request", {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            zone: process.env.BRIGHTDATA_ZONE ?? "web_unlocker1",
            url,
            format: "raw",
            country: (opts.country ?? "CZ").toLowerCase(),
          }),
          signal: paidSignal(timeoutMs, signal),
        });
        return { status: res.status, body: await readBodyCapped(res) };
      }, signal),
  },
  {
    name: "scrape.do",
    enabled: () => scrapedo.available(),
    run: (url, opts, timeoutMs, signal) =>
      scrapedo.run(async (key) => {
        const api = `https://api.scrape.do/?token=${key}&url=${encodeURIComponent(url)}&super=true&geoCode=${(opts.country ?? "CZ").toLowerCase()}`;
        const res = await fetch(api, { signal: paidSignal(timeoutMs, signal) });
        return { status: res.status, body: await readBodyCapped(res) };
      }, signal),
  },
  {
    name: "firecrawl",
    enabled: () => firecrawl.available(),
    run: (url, opts, timeoutMs, signal) =>
      firecrawl.run(async (key) => {
        const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({ url, formats: ["rawHtml"], location: { country: opts.country ?? "CZ" }, timeout: timeoutMs }),
          signal: paidSignal(timeoutMs + 5000, signal),
        });
        const j = JSON.parse(await readBodyCapped(res)) as { success?: boolean; data?: { rawHtml?: string; metadata?: { statusCode?: number } } };
        if (!res.ok || !j.success) throw new KeyError(`firecrawl HTTP ${res.status}`, res.status);
        return { status: j.data?.metadata?.statusCode ?? 200, body: j.data?.rawHtml ?? "" };
      }, signal),
  },
  {
    name: "browserbase",
    enabled: browserbaseEnabled,
    run: (url, _opts, timeoutMs, signal) => browserbaseRun(url, timeoutMs, signal),
  },
];

const downUntil = new Map<string, number>();
const failStreak = new Map<string, number>();
const SIDECAR_STREAK = Number(process.env.SIDECAR_FAIL_STREAK ?? 3);

function usable(status: number, body: string): boolean {
  if (status === 401 || status === 402 || status === 403 || status === 429 || status >= 500) return false;
  if (status === 200 && /<title>\s*Just a moment/i.test(body.slice(0, 4000))) return false;
  return true;
}

interface Attempt {
  result?: FetchResult;
  last?: FetchResult;
  error?: string;
  overloaded?: OverloadedError;
}

function runnable(p: Provider): boolean {
  return p.enabled() && (downUntil.get(p.name) ?? 0) <= Date.now() && !(p.name === "sidecar" && sidecarBlocked());
}

async function attempt(p: Provider, url: string, opts: FetchOpts, timeoutMs: number, signal: AbortSignal): Promise<Attempt> {
  const paid = p.name !== "sidecar" && !p.free;
  if (paid) {
    if (!paidBudgetLeft()) {
      track({ url: "/upstream", name: "paid_budget_exhausted", data: { provider: p.name } });
      return { error: `${p.name}: daily budget of ${PAID_DAILY_MAX} paid requests used up` };
    }
    paidUsed++;
  }
  const t = paid ? Math.max(timeoutMs, PAID_MIN_TIMEOUT_MS) : timeoutMs;
  const started = Date.now();
  let status = 0;
  let outcome: Attempt;
  try {
    const r = await p.run(url, opts, t, signal);
    status = r.status;
    if (usable(r.status, r.body)) {
      track({ url: "/upstream", name: "upstream", data: { provider: p.name, ok: true, status, ms: Date.now() - started, paid } });
      console.log(`[fetch] ${p.name} ${r.status} ${Date.now() - started}ms ${new URL(url).pathname}${new URL(url).search}`);
      failStreak.set(p.name, 0);
      return { result: { ...r, via: p.name } };
    }
    outcome = { last: { ...r, via: p.name }, error: `${p.name}: HTTP ${r.status}` };
  } catch (e) {
    if (e instanceof OverloadedError) return { overloaded: e };
    // another provider won the race and this request was told to stop: nothing is wrong with the provider
    if (signal.aborted) return {};
    outcome = { error: `${p.name}: ${e instanceof Error ? e.message : e}` };
  }
  track({ url: "/upstream", name: "upstream", data: { provider: p.name, ok: false, status, ms: Date.now() - started, paid } });
  const streak = (failStreak.get(p.name) ?? 0) + 1;
  failStreak.set(p.name, streak);
  if (paid || streak >= SIDECAR_STREAK) {
    downUntil.set(p.name, Date.now() + (paid ? COOLDOWN_MS : SIDECAR_COOLDOWN_MS));
  }
  console.warn(`[fetch] ${p.name} failed for ${url} (${outcome.error}), trying next`);
  return outcome;
}

// The free providers go first, our own workers in the order they were given, then the sidecar, which is waited for alone. Paid
// providers follow in order, but when one has not answered after hedgeMs the next one starts alongside it and the first usable
// answer wins, so one slow provider does not eat the whole deadline of an embed.
// The ones still running when a winner is in are aborted, so a lost race does not keep a connection (and a paid request) open.
export async function fetchWith(list: Provider[], url: string, opts: FetchOpts = {}, hedgeMs = HEDGE_MS): Promise<FetchResult> {
  const timeoutMs = opts.timeoutMs ?? 25_000;
  const errors: string[] = [];
  let last: FetchResult | null = null;
  let winner: FetchResult | null = null;
  let overloaded: OverloadedError | null = null;
  const pending = new Set<Promise<void>>();
  const running = new Map<Promise<void>, AbortController>();

  const order = list
    .map((p, i) => ({ p, rank: p.free ? -3 + i / 100 : p.name === "sidecar" ? -2 : p.name === "firecrawl" && sidecarBlocked() ? -1.5 : (opts.prefer?.indexOf(p.name) ?? -1) >= 0 ? -1 : i }))
    .sort((a, b) => a.rank - b.rank || (opts.prefer?.indexOf(a.p.name) ?? 0) - (opts.prefer?.indexOf(b.p.name) ?? 0))
    .map((x) => x.p);

  for (const p of order) {
    if (winner || overloaded) break;
    if (!runnable(p)) continue;
    const controller = new AbortController();
    const job: Promise<void> = attempt(p, url, opts, timeoutMs, controller.signal)
      .then((a) => {
        if (a.result && !winner) winner = a.result;
        if (a.last) last = a.last;
        if (a.error) errors.push(a.error);
        if (a.overloaded) overloaded = a.overloaded;
      })
      .finally(() => {
        pending.delete(job);
        running.delete(job);
      });
    pending.add(job);
    running.set(job, controller);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stagger = p.name === "sidecar" ? new Promise<void>(() => {}) : new Promise<void>((resolve) => (timer = setTimeout(resolve, hedgeMs)));
    await Promise.race([job, stagger]);
    clearTimeout(timer);
  }
  while (!winner && !overloaded && pending.size > 0) await Promise.race([...pending]);

  if (winner) {
    for (const controller of running.values()) controller.abort(new Error("another provider answered first"));
    return winner;
  }
  if (overloaded) throw overloaded;
  if (last) {
    const l: FetchResult = last;
    console.warn(`[fetch] no usable response, returning ${l.via} HTTP ${l.status} for ${new URL(url).pathname}${new URL(url).search}`);
    return l;
  }
  throw new Error(`all fetch providers failed: ${errors.join("; ") || "no provider available (disabled or cooling down)"}`);
}

export function fetchUrl(url: string, opts: FetchOpts = {}): Promise<FetchResult> {
  return fetchWith(providers, url, opts);
}
