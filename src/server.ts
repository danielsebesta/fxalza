import http from "node:http";
import { readFileSync } from "node:fs";
import { fetchProduct, slugTitle, stopSidecar, type BenefitEntry, type ProductData } from "./alza.ts";
import { flushCache, getCached, peekCached, putCached } from "./cache.ts";
import { benefitEmoji, emojiMd, emojiRef } from "./emoji.ts";
import { DEMO_CSP, DEMO_HTML, FAVICON_SVG, LANDING_CSP, LLMS_TXT, PUBLIC_URL, SITEMAP_XML, landingHtml } from "./landing.ts";
import { allowFetch, clientId, isDiscord } from "./ratelimit.ts";
import { createHash } from "node:crypto";
import { brotliCompressSync, gzipSync } from "node:zlib";

const PORT = Number(process.env.PORT ?? 8484);
const HOST = process.env.HOST ?? "127.0.0.1";
const IMG_W = process.env.IMG_W ?? "600";
const BOT_RE =
  /(bot|facebook|embed|got|firefox\/92|firefox\/38|chrome\/96\.0\.4664\.110|curl|wget|go-http|yahoo|generator|whatsapp|revoltchat|preview|link|proxy|vkshare|images|analyzer|index|crawl|spider|python|node|deno|mastodon|http\.rb|ruby|bun\/|fiddler|iframely|steamchaturllookup|bluesky|matrix-media-repo|cardyb|resolver|util|feedly|rss|reader|atom|thunderbird|axios)/i;
const APEX = new URL(PUBLIC_URL).hostname.toLowerCase();
const SERVED_SUBDOMAINS = new Set(["www", "m"]);

const UTM = "utm_source=fxalza&utm_medium=discord";
const DISCLAIMER = "Neoficiální nástroj, s Alza.cz nijak nesouvisí.";

interface Parsed {
  id: string;
  path: string;
}

function parseProductPath(pathname: string): Parsed | null {
  const slug = pathname.match(/^(\/[A-Za-z0-9._~%/-]*?-d(\d{1,12}))(?:\.[A-Za-z0-9]+)?\/?$/i);
  if (slug) return { id: slug[2]!, path: `${slug[1]}.htm` };
  const bare = pathname.match(/^\/d?(\d{1,12})\/?$/i);
  if (bare) return { id: bare[1]!, path: `/-d${bare[1]}.htm` };
  const any = pathname.match(/-d(\d{1,12})(?!\d)/i);
  return any ? { id: any[1]!, path: `/-d${any[1]}.htm` } : null;
}

const ALZA_HOST = /^\/(?:https?:\/+)?((?:[a-z0-9-]+\.)*alza\.(cz|sk|de|at|ch|hu|pl|co\.uk))(\/.*)?$/i;

function unsupportedHtml(tld: string, target: string): string {
  const title = `fxalza podporuje jen Alza.cz`;
  const desc = `Odkaz na alza.${tld} zatím nejde zobrazit, funguje jen Alza.cz (české produkty).`;
  return `<!DOCTYPE html>
<html lang="cs">
<head>
  <meta charset="utf-8">
  <title>${esc(title)}</title>
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="fxalza">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(desc)}">
  <meta property="og:url" content="${esc(target)}">
  <meta http-equiv="refresh" content="0;url=${esc(target)}">
  <meta name="theme-color" content="#0f6fc5">
</head>
<body><p>${esc(desc)}</p><p><a href="${esc(target)}">Přejít na Alzu</a></p></body>
</html>`;
}

const EMBED_DEADLINE_MS = Number(process.env.EMBED_DEADLINE_MS ?? 5000);
const inflight = new Map<string, Promise<ProductData>>();

function refresh(id: string, path: string): Promise<ProductData> {
  let p = inflight.get(id);
  if (!p) {
    p = fetchProduct(id, path, (benefits) => {
      const current = getCached(id, true);
      if (current) putCached(id, { ...current, benefits });
    })
      .then((d) => {
        putCached(id, d);
        return d;
      })
      .finally(() => inflight.delete(id));
    inflight.set(id, p);
  }
  return p;
}

interface Requester {
  id: string;
  discord: boolean;
}

interface ProductResult {
  data: ProductData | null;
  stale: boolean;
  limited?: boolean;
}

async function getProduct(id: string, path: string, who: Requester): Promise<ProductResult> {
  const hit = peekCached(id);
  console.log(`[product] ${id} cache ${hit?.state ?? "miss"}`);
  if (hit?.state === "fresh") return { data: hit.data, stale: false };
  const mayFetch = (): boolean => inflight.has(id) || allowFetch(who.id, who.discord);
  if (hit?.state === "stale") {
    if (mayFetch()) refresh(id, path).catch((e) => console.error(`[fetch] ${id} background refresh failed: ${e instanceof Error ? e.message : e}`));
    return { data: hit.data, stale: false };
  }
  if (!mayFetch()) {
    console.warn(`[rate] ${who.discord ? "discord" : "other"} ${who.id} limited on ${id}`);
    const old = getCached(id, true);
    return old ? { data: old, stale: true } : { data: null, stale: false, limited: true };
  }
  try {
    const pending = refresh(id, path);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const data = await Promise.race([
      pending,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), EMBED_DEADLINE_MS);
      }),
    ]);
    clearTimeout(timer);
    if (data) return { data, stale: false };
    console.warn(`[product] ${id} not ready after ${EMBED_DEADLINE_MS}ms, answering with what we have`);
    pending.catch((e) => console.error(`[fetch] ${id} failed after the deadline: ${e instanceof Error ? e.message : e}`));
    const old = getCached(id, true);
    return { data: old, stale: old !== null };
  } catch (e) {
    console.error(`[fetch] ${id} failed: ${e instanceof Error ? e.message : e}`);
    const old = getCached(id, true);
    return { data: old, stale: old !== null };
  }
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function withUtm(url: string): string {
  if (/[?&]utm_source=/.test(url)) return url;
  return url + (url.includes("?") ? "&" : "?") + UTM;
}

function fmtPct(value: number): string {
  const v = Math.round(value * 10) / 10;
  return `−${new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 1 }).format(v)} %`;
}

function mdEsc(s: string): string {
  return s.replace(/([\\*_[\]~`|])/g, "\\$1");
}

function benefitLine(e: BenefitEntry, custom = false): string {
  const pct = e.percent !== null && e.percent >= 0.1 ? ` (${fmtPct(e.percent)})` : "";
  const was = e.wasPriceText ? `${e.wasPriceText} → ` : "";
  const name = e.note ? `${e.label} + ${e.note}` : e.label;
  if (!custom) return `${benefitEmoji(e, false)} ${name} ${was}${e.priceText}${pct}`;
  const label = name.replace(/^(S kódem )([^\s`]+)$/, "$1`$2`");
  return `${benefitEmoji(e, true)} ${label} ${was}**${e.priceText}**${pct}`;
}

function componentEmbedJson(p: ProductData, canonical: string, img: string | null): string | null {
  const titleLine = `### **[${mdEsc(p.name)}](${canonical})** (${p.availabilityText})`;
  const hasSale = (p.benefits ?? []).some((b) => b.kind === "sale");
  const priceLine =
    p.priceText && !hasSale ? `${emojiMd("alza_price", "🏷️")} Cena **${p.priceText}**` : null;
  const benefitLines = [...(priceLine ? [priceLine] : []), ...(p.benefits ?? []).map((b) => benefitLine(b, true))];
  const humanUrl = withUtm(canonical);

  const desc = p.description ? mdEsc(p.description) : "";

  const build = (lines: string[], withThumb: boolean, withDesc = true): string => {
    const parts = [titleLine];
    if (withDesc && desc) {
      parts.push(desc);
      if (lines.length > 0) parts.push("");
    }
    const summary = [...parts, ...lines.map((l) => `- ${l}`)].join("\n");
    const components: unknown[] = [];
    if (withThumb && img) {
      components.push({
        type: 9,
        components: [{ type: 10, content: summary }],
        accessory: { type: 11, media: { url: img } },
      });
    } else {
      components.push({ type: 10, content: summary });
    }
    components.push({ type: 14 });
    components.push({
      type: 1,
      components: [
        {
          type: 2,
          style: 5,
          url: humanUrl,
          label: "Otevřít na Alze",
          ...(emojiRef("alza_logo") ? { emoji: emojiRef("alza_logo") } : {}),
        },
      ],
    });
    return JSON.stringify({ component: { type: 17, accent_color: 1011653, components } }).replace(
      /</g,
      "\\u003c",
    );
  };

  const fits = (json: string): boolean => Buffer.byteLength(json, "utf8") <= 2900;
  for (let n = benefitLines.length; n >= 0; n--) {
    for (const withDesc of [true, false]) {
      const json = build(benefitLines.slice(0, n), true, withDesc);
      if (fits(json)) return json;
    }
  }
  const lean = build([], false);
  return fits(lean) ? lean : null;
}

function embedHtml(p: ProductData | null, path: string, stale: boolean, metaRefresh: boolean): string {
  const fallbackTitle = slugTitle(path);
  const canonical = p?.canonicalUrl ?? `https://www.alza.cz${path}`;

  let title = p?.name ?? fallbackTitle;
  if (p?.priceText) title = `${p.name} | ${p.priceText}`;

  const parts: string[] = [];
  if (p) {
    parts.push(p.availabilityText);
    if (p.rating !== null && p.rating > 0) {
      const stars = `${p.rating.toFixed(1).replace(".", ",")}/5`;
      parts.push(`★ ${stars}${p.ratingCount ? ` (${p.ratingCount} hodnocení)` : ""}`);
    }
    for (const b of p.benefits ?? []) parts.push(benefitLine(b));
    if (p.brand) parts.push(p.brand);
    if (stale) parts.push("data mohou být starší");
  } else {
    parts.push("Odkaz na Alza.cz — při načítání ceny nastala chyba");
  }
  let desc = parts.join(" • ");
  while (Buffer.byteLength(desc, "utf8") > 330 && parts.length > 1) {
    parts.pop();
    desc = parts.join(" • ");
  }

  const img = p?.image ? `${p.image}?width=${IMG_W}&height=${IMG_W}` : null;
  const componentJson = p ? componentEmbedJson(p, canonical, img) : null;

  const tags = [
    `<meta charset="utf-8">`,
    `<title>${esc(title)} | Alza.cz</title>`,
    `<meta property="og:type" content="product">`,
    `<meta property="og:site_name" content="Alza.cz">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(desc)}">`,
    img ? `<meta property="og:image" content="${esc(img)}">` : "",
    img ? `<meta property="og:image:width" content="${IMG_W}">` : "",
    img ? `<meta property="og:image:height" content="${IMG_W}">` : "",
    `<meta property="og:url" content="${esc(canonical)}">`,
    `<meta property="og:locale" content="cs_CZ">`,
    img ? `<meta property="og:image:alt" content="${esc(title)}">` : "",
    p?.price != null ? `<meta property="product:price:amount" content="${p.price}">` : "",
    p?.price != null ? `<meta property="product:price:currency" content="CZK">` : "",
    componentJson ? `<script id="discord:component-embed" type="application/json">${componentJson}</script>` : "",
    metaRefresh ? `<meta http-equiv="refresh" content="0;url=${esc(withUtm(canonical))}">` : "",
    `<meta name="twitter:card" content="${img ? "summary_large_image" : "summary"}">`,
    `<meta name="theme-color" content="#0f6fc5">`,
  ]
    .filter(Boolean)
    .join("\n  ");

  const benefitRows = (p?.benefits ?? []).map((e) => `<li>${esc(benefitLine(e))}</li>`);
  const bodyRows = [
    `<h1>${esc(title)}</h1>`,
    `<p>${esc(desc)}</p>`,
    benefitRows.length > 0 ? `<ul>${benefitRows.join("")}</ul>` : "",
    img ? `<img src="${esc(img)}" width="240" alt="">` : "",
    `<p><a href="${esc(withUtm(canonical))}">Přejít na Alza.cz</a></p>`,
    `<p class="note">${DISCLAIMER}</p>`,
  ].filter(Boolean);

  return `<!DOCTYPE html>
<html lang="cs">
<head>
  ${tags}
  <style>body{font:16px/1.5 system-ui,sans-serif;max-width:40rem;margin:2rem auto;padding:0 1rem;color:#222}.note{color:#888;font-size:13px}</style>
</head>
<body>
  ${bodyRows.join("\n  ")}
</body>
</html>`;
}

const BASE_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  "cross-origin-opener-policy": "same-origin",
  "x-robots-tag": "noindex, nofollow",
};

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, HEAD, OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "86400",
};

const compressed = new Map<string, Buffer>();
function sendStatic(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  body: string,
  type: string,
  extra: Record<string, string> = {},
  maxAge = 3600,
): void {
  const etag = `"${createHash("sha1").update(body).digest("base64url").slice(0, 22)}"`;
  const headers: Record<string, string> = {
    "content-type": type,
    "cache-control": `public, max-age=${maxAge}, stale-while-revalidate=86400`,
    etag,
    vary: "Accept-Encoding",
    ...extra,
  };
  if (req.headers["if-none-match"] === etag) {
    res.writeHead(304, headers);
    res.end();
    return;
  }
  const accept = String(req.headers["accept-encoding"] ?? "");
  const enc = /\bbr\b/.test(accept) ? "br" : /\bgzip\b/.test(accept) ? "gzip" : "";
  let out: Buffer = Buffer.from(body, "utf8");
  if (enc) {
    const key = `${etag}:${enc}`;
    let c = compressed.get(key);
    if (!c) {
      c = enc === "br" ? brotliCompressSync(out) : gzipSync(out);
      compressed.set(key, c);
      if (compressed.size > 50) compressed.delete(compressed.keys().next().value!);
    }
    out = c;
    headers["content-encoding"] = enc;
  }
  headers["content-length"] = String(out.length);
  res.writeHead(200, headers);
  res.end(req.method === "HEAD" ? undefined : out);
}

const FONTS = new Map<string, Buffer>();
for (const family of ["roboto"]) {
  for (const part of ["latin", "latin-ext"]) {
    try {
      FONTS.set(`/fonts/${family}-${part}.woff2`, readFileSync(new URL(`../assets/fonts/${family}-${part}-wght-normal.woff2`, import.meta.url)));
    } catch {
    }
  }
}

const ROBOTS_TXT = `User-agent: *
Allow: /$
Disallow: /

Sitemap: ${PUBLIC_URL}/sitemap.xml
`;

const server = http.createServer(async (req, res) => {
  for (const [k, v] of Object.entries(BASE_HEADERS)) res.setHeader(k, v);
  const started = Date.now();
  const ua = String(req.headers["user-agent"] ?? "");
  const isBot = BOT_RE.test(ua);
  const who: Requester = { id: clientId(req), discord: isDiscord(ua) };
  let logged = "";

  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204, { ...CORS_HEADERS, allow: "GET, HEAD, OPTIONS" });
      res.end();
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { Allow: "GET, HEAD, OPTIONS" });
      res.end();
      return;
    }

    const u = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    logged = u.pathname;

    const host = String(req.headers.host ?? "").replace(/:d+$/, "").toLowerCase();
    if (!isBot && host.endsWith(`.${APEX}`) && !SERVED_SUBDOMAINS.has(host.slice(0, -APEX.length - 1))) {
      const p = parseProductPath(u.pathname);
      res.writeHead(302, { Location: p ? withUtm(`https://www.alza.cz${p.path}`) : `${PUBLIC_URL}/`, "cache-control": "no-store", vary: "Accept-Encoding, User-Agent" });
      res.end();
      return;
    }

    if (u.pathname === "/favicon.svg" || u.pathname === "/favicon.ico") {
      sendStatic(req, res, FAVICON_SVG, "image/svg+xml", { "x-robots-tag": "all" }, 86400);
      return;
    }
    const font = FONTS.get(u.pathname);
    if (font) {
      res.writeHead(200, {
        "content-type": "font/woff2",
        "content-length": String(font.length),
        "cache-control": "public, max-age=31536000, immutable",
        "x-robots-tag": "noindex",
      });
      res.end(req.method === "HEAD" ? undefined : font);
      return;
    }
    if (u.pathname === "/robots.txt") {
      sendStatic(req, res, ROBOTS_TXT, "text/plain; charset=utf-8", { "x-robots-tag": "all" }, 3600);
      return;
    }
    if (u.pathname === "/demo") {
      sendStatic(req, res, DEMO_HTML, "text/html; charset=utf-8", { "content-security-policy": DEMO_CSP, "x-frame-options": "SAMEORIGIN", "x-robots-tag": "noindex" }, 600);
      return;
    }
    if (u.pathname === "/sitemap.xml") {
      sendStatic(req, res, SITEMAP_XML, "application/xml; charset=utf-8", { "x-robots-tag": "all" }, 3600);
      return;
    }
    if (u.pathname === "/llms.txt") {
      sendStatic(req, res, LLMS_TXT, "text/plain; charset=utf-8", { "x-robots-tag": "all" }, 3600);
      return;
    }
    let pathname = u.pathname;
    const alza = ALZA_HOST.exec(pathname);
    if (alza) {
      const tld = alza[2]!.toLowerCase();
      if (tld === "cz") {
        pathname = alza[3] ?? "/";
      } else {
        const target = `https://${alza[1]!.toLowerCase()}${alza[3] ?? "/"}${u.search}`;
        if (u.searchParams.get("format") === "json") {
          res.writeHead(422, { "content-type": "application/json; charset=utf-8", ...CORS_HEADERS });
          res.end(JSON.stringify({ error: "unsupported_domain", domain: `alza.${tld}`, supported: ["alza.cz"] }));
        } else if (!isBot) {
          res.writeHead(302, { Location: target, "cache-control": "no-store", vary: "Accept-Encoding, User-Agent" });
          res.end();
        } else {
          res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", vary: "Accept-Encoding, User-Agent" });
          res.end(req.method === "HEAD" ? undefined : unsupportedHtml(tld, target));
        }
        return;
      }
    }
    const parsed = parseProductPath(pathname);
    if (!parsed) {
      if (pathname === "/" && !alza) {
        sendStatic(
          req,
          res,
          landingHtml(String(req.headers.host ?? "fxalza.cz"), DISCLAIMER),
          "text/html; charset=utf-8",
          {
            "content-security-policy": LANDING_CSP,
            "x-frame-options": "DENY",
            "x-robots-tag": "index, follow",
            link: `<${PUBLIC_URL}/>; rel="canonical"`,
          },
          600,
        );
      } else {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        res.end("Neznámá cesta. Použij tvar /<slug>-d<id>.htm nebo /d<id>.\n");
      }
      return;
    }

    const isDebug = u.searchParams.get("debug") === "1";

    if (u.searchParams.get("format") === "json") {
      const { data, stale, limited } = await getProduct(parsed.id, parsed.path, who);
      if (limited) {
        res.writeHead(429, { "content-type": "application/json; charset=utf-8", "retry-after": "60", "cache-control": "no-store", ...CORS_HEADERS });
        res.end(JSON.stringify({ error: "rate_limited", retryAfter: 60 }));
        return;
      }
      const body = JSON.stringify(
        data ? { ...data, stale } : { id: parsed.id, error: "fetch_failed", canonicalUrl: `https://www.alza.cz${parsed.path}` },
        null,
        1,
      );
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "public, max-age=60, stale-while-revalidate=300",
        ...CORS_HEADERS,
        "access-control-expose-headers": "content-length",
      });
      res.end(req.method === "HEAD" ? undefined : body);
      return;
    }

    if (!isBot && !isDebug) {
      const known = getCached(parsed.id, true);
      const target = withUtm(known?.canonicalUrl ?? `https://www.alza.cz${parsed.path}`);
      res.writeHead(302, { Location: target, "cache-control": "no-store", vary: "Accept-Encoding, User-Agent" });
      res.end();
      return;
    }

    const { data, stale, limited } = await getProduct(parsed.id, parsed.path, who);
    if (limited) {
      res.writeHead(429, { "content-type": "text/plain; charset=utf-8", "retry-after": "60", "cache-control": "no-store" });
      res.end("Příliš mnoho požadavků, zkus to za chvíli.\n");
      return;
    }
    const html = embedHtml(data, parsed.path, stale, !isDebug);
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      vary: "Accept-Encoding, User-Agent",
    });
    res.end(req.method === "HEAD" ? undefined : html);
  } catch (e) {
    console.error("[server] error:", e);
    let fallback: Parsed | null = null;
    try {
      fallback = parseProductPath(new URL(req.url ?? "/", "http://localhost").pathname);
    } catch {
      fallback = null;
    }
    if (!res.headersSent && isBot && fallback) {
      const html = embedHtml(null, fallback.path, false, true);
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        vary: "Accept-Encoding, User-Agent",
      });
      res.end(html);
    } else if (!res.headersSent) {
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      res.end("Interní chyba\n");
    } else {
      res.end();
    }
  } finally {
    const ms = Date.now() - started;
    console.log(`${new Date().toISOString()} ${isBot ? "bot " : "human"} ${res.statusCode} ${ms}ms ${logged} (${ua.slice(0, 40)})`);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[server] fxalza listening on http://${HOST}:${PORT}`);
});

process.once("SIGINT", () => {
  flushCache();
  stopSidecar();
  server.close();
  process.exit(0);
});
process.once("SIGTERM", () => {
  flushCache();
  stopSidecar();
  server.close();
  process.exit(0);
});
