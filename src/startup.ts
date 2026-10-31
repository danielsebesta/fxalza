// What the server was started with and whether what it depends on answers, printed once after it is listening.
// Nothing here costs money: the keys are tried on the account or usage endpoints of their providers, the workers with a request
// that carries no address to fetch, and no key, token or worker address ever reaches the log, only counts and results.
import { execFileSync } from "node:child_process";
import { cacheSize } from "./cache.ts";
import { parseCfWorkers, sidecarStats } from "./fetcher.ts";
import { browserbaseEnabled } from "./browserbase.ts";
import { SHOPS, SITE_APEX } from "./shops.ts";

const CHECK_MS = 6000;
const env = (name: string): string => (process.env[name] ?? "").trim();
const keysOf = (name: string): string[] => [...new Set(env(name).split(/[\s,;]+/).filter(Boolean))];

type Verdict = "ok" | "bad" | "unknown";
interface Result {
  verdict: Verdict;
  text: string;
}

const MARK: Record<Verdict, string> = { ok: "ok  ", bad: "FAIL", unknown: "??  " };
const ok = (text: string): Result => ({ verdict: "ok", text });
const bad = (text: string): Result => ({ verdict: "bad", text });
const unknown = (text: string): Result => ({ verdict: "unknown", text });

async function get(url: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(CHECK_MS), redirect: "manual" });
  return { status: res.status, body: (await res.text()).slice(0, 400_000) };
}

const asJson = (body: string): any => {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
};
const fail = (e: unknown): Result => unknown(`no answer: ${e instanceof Error ? (e.name === "TimeoutError" ? "timed out" : e.message) : e}`);
const num = (n: unknown): string => (typeof n === "number" && Number.isFinite(n) ? n.toLocaleString("en-US").replace(/,/g, " ") : "?");

// One line per key: the keys are numbered the way the [keys] warnings of the fetcher number them.
async function eachKey(name: string, check: (key: string) => Promise<Result>): Promise<Result[]> {
  return Promise.all(
    keysOf(name).map(async (key) => {
      try {
        return await check(key);
      } catch (e) {
        return fail(e);
      }
    }),
  );
}

function git(): string {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: new URL("..", import.meta.url), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 2000 }).trim();
  } catch {
    return "no git";
  }
}

function yes(on: boolean): string {
  return on ? "on" : "off";
}

function describe(): string[] {
  const workers = parseCfWorkers(process.env.CF_WORKERS);
  const sidecar = sidecarStats();
  const umami = env("UMAMI_WEBSITE_ID");
  const umamiUrl = env("UMAMI_URL") || "https://cloud.umami.is";
  const shopDomains = Object.values(SHOPS).map((s) => s.code).join(", ");
  return [
    `version      ${git()}, node ${process.versions.node}, pid ${process.pid}`,
    `address      ${env("HOST") || "127.0.0.1"}:${env("PORT") || "8484"}, public ${env("PUBLIC_URL") || `https://${SITE_APEX}`}, shops ${shopDomains}`,
    `cache        ${cacheSize()} products, ttl ${num(Number(env("CACHE_TTL_MS") || 86_400_000) / 3600_000)} h, file ${env("CACHE_FILE") || "data/cache.json"}`,
    `sidecar      ${env("SIDECAR_DISABLED") === "1" ? "disabled" : `${sidecar.alive} of ${sidecar.workers} workers started (they start on demand)`}, proxy ${yes(!!env("ALZA_PROXY_URL"))}, warp key ${yes(!!env("WARP_PRIVATE_KEY"))}`,
    `fetchers     cf workers ${workers.length}, brightdata ${keysOf("BRIGHTDATA_KEY").length}, scrape.do ${keysOf("SCRAPEDO_TOKEN").length}, firecrawl ${keysOf("FIRECRAWL_KEY").length}, browserbase ${browserbaseEnabled() ? 1 : 0}`,
    `paid budget  ${env("PAID_DAILY_MAX") || 300} requests a day (Bright Data, Scrape.do and Firecrawl together)`,
    `rate limits  discord ${env("RATE_DISCORD_PER_MIN") || 30}/min, others ${env("RATE_OTHER_PER_10MIN") || 3}/10 min, global ${env("RATE_GLOBAL_PER_MIN") || 45}/min, strict address check ${yes(env("DISCORD_IPS_STRICT") !== "0")}`,
    `umami        ${umami ? `on, ${new URL(umamiUrl).host}, site ${umami.slice(0, 8)}...` : "off (UMAMI_WEBSITE_ID is empty)"}`,
    `hlidac shopu ${env("HISTORY") === "0" ? "off" : "on"}`,
    `benefits     ${env("BENEFITS") === "0" ? "off" : "on"}`,
  ];
}

export async function printStartupReport(): Promise<void> {
  const lines = describe();
  console.log(`[startup] fxalza\n${lines.map((l) => `[startup]   ${l}`).join("\n")}`);

  const checks: [string, Promise<Result[] | Result>][] = [];

  checks.push([
    "outbound ip",
    get("https://api.ipify.org")
      .then((r) => (r.status === 200 && /^[0-9a-f:.]{3,45}$/i.test(r.body.trim()) ? ok(`${r.body.trim()} (what Hlídač shopů and the other APIs see; the sidecar goes ${env("ALZA_PROXY_URL") ? "through its proxy" : "the same way"})`) : unknown(`HTTP ${r.status}`)))
      .catch(fail),
  ]);

  const umami = env("UMAMI_WEBSITE_ID");
  if (umami) {
    const base = (env("UMAMI_URL") || "https://cloud.umami.is").replace(/\/+$/, "");
    checks.push([
      "umami",
      get(`${base}/api/heartbeat`)
        .then((r) => (r.status === 200 ? ok(`${new URL(base).host} answers`) : r.status === 404 ? unknown(`${new URL(base).host} answers but has no heartbeat (HTTP 404)`) : bad(`${new URL(base).host} HTTP ${r.status}`)))
        .catch(fail),
    ]);
  }

  if (env("HISTORY") !== "0") {
    checks.push([
      "hlidac shopu",
      get(`https://api.hlidacshopu.cz/v2/detail?url=${encodeURIComponent("https://www.alza.cz/-d7356338.htm")}`)
        .then((r) => (r.status === 200 && r.body.includes("\"metadata\"") ? ok("answers") : bad(`HTTP ${r.status}`)))
        .catch(fail),
    ]);
  }

  const workers = parseCfWorkers(process.env.CF_WORKERS);
  if (workers.length > 0) {
    checks.push([
      "cf workers",
      Promise.all(
        workers.map(async (w): Promise<Result> => {
          try {
            // the right token with no address to fetch gets a 400 and fetches nothing, a wrong one a 401
            const r = await get(`${w.url}/`, { "x-token": w.token });
            return r.status === 400 ? ok(`${w.name} answers, token accepted`) : r.status === 401 ? bad(`${w.name} refuses the token`) : unknown(`${w.name} HTTP ${r.status}`);
          } catch (e) {
            return fail(e);
          }
        }),
      ),
    ]);
  }

  checks.push([
    "scrape.do",
    eachKey("SCRAPEDO_TOKEN", async (key) => {
      const r = await get(`https://api.scrape.do/info?token=${encodeURIComponent(key)}`);
      const j = asJson(r.body);
      if (r.status !== 200 || !j) return unknown(`HTTP ${r.status}`);
      if (j.IsActive === false) return bad("token inactive or unknown");
      return ok(`active, ${num(j.RemainingMonthlyRequest)} requests left this month`);
    }),
  ]);

  checks.push([
    "firecrawl",
    eachKey("FIRECRAWL_KEY", async (key) => {
      const r = await get("https://api.firecrawl.dev/v1/team/credit-usage", { authorization: `Bearer ${key}` });
      const j = asJson(r.body);
      if (r.status === 401 || r.status === 403) return bad(`HTTP ${r.status}`);
      if (r.status !== 200) return unknown(`HTTP ${r.status}`);
      return ok(`active, ${num(j?.data?.remaining_credits)} credits left`);
    }),
  ]);

  const zone = env("BRIGHTDATA_ZONE") || "web_unlocker1";
  checks.push([
    "brightdata",
    eachKey("BRIGHTDATA_KEY", async (key) => {
      const r = await get("https://api.brightdata.com/zone/get_active_zones", { authorization: `Bearer ${key}` });
      // a key made for the unlocker may not be allowed to list zones, and the one call that proves it works costs a request
      if (r.status === 401 || r.status === 403) return unknown(`HTTP ${r.status}, the key cannot be tried without a paid request`);
      const j = asJson(r.body);
      if (r.status !== 200 || !Array.isArray(j)) return unknown(`HTTP ${r.status}`);
      return j.some((z: any) => z?.name === zone) ? ok(`active, zone ${zone} found`) : bad(`key works but zone ${zone} is not active`);
    }),
  ]);

  if (browserbaseEnabled()) {
    checks.push([
      "browserbase",
      get("https://api.browserbase.com/v1/projects", { "x-bb-api-key": env("BROWSERBASE_API_KEY") })
        .then((r) => (r.status === 200 ? ok("key accepted") : r.status === 401 || r.status === 403 ? bad(`HTTP ${r.status}`) : unknown(`HTTP ${r.status}`)))
        .catch(fail),
    ]);
  }

  const done = await Promise.all(checks.map(async ([name, p]) => [name, await p] as const));
  const out: string[] = [];
  let problems = 0;
  for (const [name, r] of done) {
    const list = Array.isArray(r) ? r : [r];
    if (list.length === 0) {
      out.push(`[startup]   ${MARK.unknown} ${name.padEnd(13)} no key set`);
      continue;
    }
    list.forEach((x, i) => {
      if (x.verdict === "bad") problems++;
      const label = list.length > 1 ? `${name} #${i + 1}` : name;
      out.push(`[startup]   ${MARK[x.verdict]} ${label.padEnd(13)} ${x.text}`);
    });
  }
  console.log(`[startup] checks, ${problems === 0 ? "nothing failed" : `${problems} failed`}\n${out.join("\n")}`);
}
