import "./logfile.ts";
import http from "node:http";
import { readFileSync } from "node:fs";
import { fetchKodList, fetchProduct, resolveProductPath, slugTitle, stopSidecar, UpstreamError, type BenefitEntry, type ProductData } from "./alza.ts";
import { platformOf, track, type TrackEvent } from "./analytics.ts";
import { kodCodes, type KodList } from "./kodlist.ts";
import { hasCacheBustSuffix, isExtensionHost, parseProductPath, type Parsed } from "./parse.ts";
import { OverloadedError } from "./sidecar.ts";
import { flushCache, getCached, peekCached, putCached } from "./cache.ts";
import { benefitEmoji, emojiMd, emojiRef } from "./emoji.ts";
import { DEMO_CSP, DEMO_HTML, FAVICON_SVG, LANDING_CSP, LLMS_TXT, PUBLIC_URL, SITEMAP_XML, landingHtml, problemHtml } from "./landing.ts";
import { allowFetch, anonymizedIp, identify, rateTier, type Requester } from "./ratelimit.ts";
import { createHash } from "node:crypto";
import { brotliCompressSync, gzipSync } from "node:zlib";

const PORT = Number(process.env.PORT ?? 8484);
const HOST = process.env.HOST ?? "127.0.0.1";
const IMG_W = process.env.IMG_W ?? "600";
const BOT_RE =
  /(bot|facebook|embed|got|firefox\/92|firefox\/38|chrome\/96\.0\.4664\.110|curl|wget|go-http|yahoo|generator|whatsapp|revoltchat|preview|link|proxy|vkshare|images|analyzer|index|crawl|spider|python|node|deno|mastodon|http\.rb|ruby|bun\/|fiddler|iframely|steamchaturllookup|bluesky|matrix-media-repo|cardyb|resolver|util|feedly|rss|reader|atom|thunderbird|axios)/i;
const APEX = new URL(PUBLIC_URL).hostname.toLowerCase();
const SERVED_SUBDOMAINS = new Set(["www", "m"]);
const EXTENSION_REPO = "https://github.com/dexnis-dev/Alza-Benefit-Prices";

const UTM = "utm_source=fxalza&utm_medium=discord";
const DISCLAIMER = "Neoficiální nástroj, s Alza.cz a.s. nijak nesouvisí.\n„Alza“ a „Alza.cz“ jsou ochranné známky společnosti Alza.cz a.s.";

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
  <meta name="theme-color" content="#e5484d">
</head>
<body><p>${esc(desc)}</p><p><a href="${esc(target)}">Přejít na Alzu</a></p></body>
</html>`;
}

const EMBED_DEADLINE_MS = Number(process.env.EMBED_DEADLINE_MS ?? 5000);
const inflight = new Map<string, Promise<ProductData>>();

function refresh(id: string, path: string): Promise<ProductData> {
  let p = inflight.get(id);
  if (!p) {
    p = fetchProduct(id, path, (benefits, complete) => {
      const current = getCached(id, true);
      if (!current) return;
      const { partial: _, ...rest } = current;
      putCached(id, { ...rest, benefits, ...(complete ? {} : { partial: true as const }) });
    })
      .then((d) => {
        negative.delete(id);
        putCached(id, d);
        return d;
      })
      .catch((e) => {
        remember(id, e);
        throw e;
      })
      .finally(() => inflight.delete(id));
    inflight.set(id, p);
  }
  return p;
}

const MISSING_TTL_MS = Number(process.env.MISSING_TTL_MS ?? 10 * 60_000);
const FAILED_TTL_MS = Number(process.env.FAILED_TTL_MS ?? 30_000);
const NEGATIVE_MAX = 2000;
const negative = new Map<string, { until: number; missing: boolean }>();

function remember(id: string, e: unknown): void {
  const missing = e instanceof UpstreamError && (e.status === 404 || e.status === 410);
  if (e instanceof OverloadedError) return;
  negative.delete(id);
  negative.set(id, { until: Date.now() + (missing ? MISSING_TTL_MS : FAILED_TTL_MS), missing });
  while (negative.size > NEGATIVE_MAX) negative.delete(negative.keys().next().value!);
}

function recalled(id: string): { missing: boolean } | null {
  const n = negative.get(id);
  if (!n) return null;
  if (n.until <= Date.now()) {
    negative.delete(id);
    return null;
  }
  return n;
}

interface ProductResult {
  data: ProductData | null;
  stale: boolean;
  limited?: boolean;
  missing?: boolean;
}

async function getProduct(id: string, path: string, who: Requester, bust = false, trace?: { cache?: string }): Promise<ProductResult> {
  const hit = peekCached(id);
  if (trace) trace.cache = hit?.state ?? "miss";
  console.log(`[product] ${id} cache ${hit?.state ?? "miss"}`);
  // A link the user changed on purpose gets another try at a partial result instead of waiting for it to expire.
  if (hit?.state === "fresh" && !(bust && hit.data.partial)) return { data: hit.data, stale: false };
  const bad = hit?.state === "stale" ? null : recalled(id);
  if (bad) {
    const old = getCached(id, true);
    return { data: old, stale: old !== null, missing: bad.missing && old === null };
  }
  const mayFetch = (): boolean => inflight.has(id) || allowFetch(who.id, rateTier(who));
  if (hit?.state === "stale") {
    if (mayFetch()) refresh(id, path).catch((e) => console.error(`[fetch] ${id} background refresh failed: ${e instanceof Error ? e.message : e}`));
    return { data: hit.data, stale: false };
  }
  if (!mayFetch()) {
    console.warn(`[rate] ${rateTier(who)} ${who.id} limited on ${id}`);
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
    const missing = e instanceof UpstreamError && (e.status === 404 || e.status === 410);
    return { data: old, stale: old !== null, missing: missing && old === null };
  }
}

const SLUG_TTL_MS = 6 * 3600_000;
const SLUG_MISS_TTL_MS = 10 * 60_000;
const SLUG_MAX = 2000;
const slugs = new Map<string, { until: number; parsed: Parsed | null }>();
const slugPending = new Map<string, Promise<Parsed | null>>();

// A path with no product id (e.g. /gaming/hogwarts-legacy) may still be an Alza link that redirects to one product, so crawlers get one upstream look at it.
async function resolveSlug(pathname: string, who: Requester): Promise<Parsed | null> {
  if (!/^\/[A-Za-z0-9._~%/-]{2,200}$/.test(pathname) || /\.(?!htm$)[A-Za-z0-9]{1,5}$/i.test(pathname)) return null;
  const known = slugs.get(pathname);
  if (known && known.until > Date.now()) return known.parsed;
  const pending = slugPending.get(pathname);
  if (pending) return pending;
  if (!allowFetch(who.id, rateTier(who))) return null;
  const p = resolveProductPath(pathname)
    .catch((e) => {
      console.warn(`[slug] ${pathname} not resolved: ${e instanceof Error ? e.message : e}`);
      return null;
    })
    .then((parsed) => {
      slugs.delete(pathname);
      slugs.set(pathname, { until: Date.now() + (parsed ? SLUG_TTL_MS : SLUG_MISS_TTL_MS), parsed });
      while (slugs.size > SLUG_MAX) slugs.delete(slugs.keys().next().value!);
      if (parsed) console.log(`[slug] ${pathname} -> ${parsed.id}`);
      return parsed;
    })
    .finally(() => slugPending.delete(pathname));
  slugPending.set(pathname, p);
  return p;
}

const KOD_RE = /^\/kod\/[A-Za-z0-9;]{1,400}$/;
const KOD_TTL_MS = 10 * 60_000;
const KOD_MISS_TTL_MS = 2 * 60_000;
const kodLists = new Map<string, { until: number; list: KodList | null }>();
const kodPending = new Map<string, Promise<KodList | null>>();

// A "Výpis zboží" page (alza.cz/kod/<code>;<code>...) lists several products in one go, so one fetch covers the whole preview.
async function getKodList(pathname: string, who: Requester): Promise<KodList | null> {
  const known = kodLists.get(pathname);
  if (known && known.until > Date.now()) return known.list;
  const pending = kodPending.get(pathname);
  if (pending) return pending;
  if (!allowFetch(who.id, rateTier(who))) return known?.list ?? null;
  const p = fetchKodList(pathname, kodCodes(pathname).length)
    .catch((e) => {
      console.warn(`[kod] ${pathname} not loaded: ${e instanceof Error ? e.message : e}`);
      return null;
    })
    .then((list) => {
      kodLists.delete(pathname);
      kodLists.set(pathname, { until: Date.now() + (list ? KOD_TTL_MS : KOD_MISS_TTL_MS), list });
      while (kodLists.size > 500) kodLists.delete(kodLists.keys().next().value!);
      return list;
    })
    .finally(() => kodPending.delete(pathname));
  kodPending.set(pathname, p);
  return p;
}

function kodHtml(list: KodList, pathname: string, carried: string, customEmoji: boolean): string {
  const listUrl = outbound(`https://www.alza.cz${pathname}`, carried);
  const totalText = `${new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 0 }).format(list.total).replace(/\u00a0/g, " ")} Kč`;
  const count = list.items.length;
  const noun = count === 1 ? "položka" : count < 5 ? "položky" : "položek";
  const heading = `Výpis zboží: ${count} ${noun}, celkem ${totalText}`;
  const missing = list.requested > count ? `Alza zobrazila ${count} z ${list.requested} položek.` : "";
  const line = (i: (typeof list.items)[number], rich: boolean): string => {
    const price = i.priceText ? (rich ? ` **${i.priceText}**` : ` ${i.priceText}`) : "";
    const was = i.wasText ? (rich ? ` ~~${i.wasText}~~` : ` (bylo ${i.wasText})`) : "";
    if (!rich) return `${shortName(i.name, 60)} –${price}${was}`;
    const history = `https://www.hlidacshopu.cz/app/?url=${encodeURIComponent(i.url)}`;
    const icon = customEmoji ? emojiMd("hlidac_shopu", "📈") : "📈";
    return `[${mdEsc(shortName(i.name, 60))}](${outbound(i.url, carried)}) —${price}${was} ${icon} [historie](${history})`;
  };
  const img = list.items.find((i) => i.image)?.image ?? null;
  const imgUrl = img ? `${img}?width=${IMG_W}&height=${IMG_W}` : null;

  const bytes = (t: string): number => Buffer.byteLength(t, "utf8");
  let desc = "";
  for (const i of list.items) {
    const next = desc ? `${desc} • ${line(i, false)}` : line(i, false);
    if (bytes(next) > 330) break;
    desc = next;
  }
  if (missing && bytes(desc) + bytes(missing) + 3 <= 330) desc = `${desc} • ${missing}`;

  const build = (n: number): string => {
    const shown = list.items.slice(0, n);
    const rest = count - n;
    const content = [
      "-# Alza.cz",
      `### **Výpis zboží** (${count} ${noun}, celkem **${totalText}**)`,
      ...shown.map((i) => `- ${line(i, true)}`),
      ...(rest > 0 ? [`-# … a ${rest} dalších`] : []),
      ...(missing ? [`-# ${missing}`] : []),
    ].join("\n");
    const components: unknown[] = [
      imgUrl
        ? { type: 9, components: [{ type: 10, content }], accessory: { type: 11, media: { url: imgUrl } } }
        : { type: 10, content },
      { type: 14 },
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 5,
            url: listUrl,
            label: "Otevřít na Alze",
            ...(customEmoji && emojiRef("alza_logo") ? { emoji: emojiRef("alza_logo") } : {}),
          },
        ],
      },
    ];
    return JSON.stringify({ component: { type: 17, accent_color: 1011653, components } }).replace(/</g, "\\u003c");
  };
  let componentJson: string | null = null;
  for (let n = count; n >= 0 && componentJson === null; n--) {
    const json = build(n);
    if (bytes(json) <= 2900) componentJson = json;
  }

  const tags = [
    `<meta charset="utf-8">`,
    `<title>${esc(heading)} | Alza.cz</title>`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="Alza.cz">`,
    `<meta property="og:title" content="${esc(heading)}">`,
    `<meta name="description" content="${esc(desc)}">`,
    `<meta property="og:description" content="${esc(desc)}">`,
    imgUrl ? `<meta property="og:image" content="${esc(imgUrl)}">` : "",
    `<meta property="og:locale" content="cs_CZ">`,
    componentJson && customEmoji ? `<script id="discord:component-embed" type="application/json">${componentJson}</script>` : "",
    customEmoji ? `<meta http-equiv="refresh" content="0;url=${esc(listUrl)}">` : "",
    `<meta name="twitter:card" content="${imgUrl ? "summary_large_image" : "summary"}">`,
    `<meta name="twitter:title" content="${esc(heading)}">`,
    `<meta name="twitter:description" content="${esc(desc)}">`,
    imgUrl ? `<meta name="twitter:image" content="${esc(imgUrl)}">` : "",
    `<meta name="theme-color" content="#0f6fc5">`,
  ]
    .filter(Boolean)
    .join("\n  ");
  const rows = list.items.map((i) => `<li>${esc(line(i, false))}</li>`).join("");
  return `<!DOCTYPE html>
<html lang="cs">
<head>
  ${tags}
  <style>body{font:16px/1.5 system-ui,sans-serif;max-width:40rem;margin:2rem auto;padding:0 1rem;color:#222}.note{color:#888;font-size:13px}</style>
</head>
<body>
  <h1>${esc(heading)}</h1>
  <ul>${rows}</ul>
  ${missing ? `<p>${esc(missing)}</p>` : ""}
  <p><a href="${esc(listUrl)}">Přejít na Alza.cz</a></p>
  <p class="note">${DISCLAIMER.replace("\n", " ")}</p>
</body>
</html>`;
}

function sendProblem(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  isBot: boolean,
  status: number,
  title: string,
  message: string,
  extra: Record<string, string> = {},
  showToBots = true,
): void {
  res.writeHead(isBot && showToBots ? 200 : status, {
    "content-type": "text/html; charset=utf-8",
    "content-security-policy": LANDING_CSP,
    "cache-control": "no-store",
    "x-robots-tag": "noindex",
    vary: "User-Agent",
    ...extra,
  });
  res.end(req.method === "HEAD" ? undefined : problemHtml(title, message));
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function withUtm(url: string): string {
  if (/[?&]utm_source=/.test(url)) return url;
  return url + (url.includes("?") ? "&" : "?") + UTM;
}

const CONTROL_PARAMS = new Set(["format", "v"]);

function carriedQuery(params: URLSearchParams): string {
  const kept = new URLSearchParams();
  for (const [key, value] of params) if (!CONTROL_PARAMS.has(key)) kept.append(key, value);
  const query = kept.toString();
  return query.length > 0 && query.length <= 512 ? query : "";
}

function outbound(url: string, carried: string): string {
  if (!carried) return withUtm(url);
  return url + (url.includes("?") ? "&" : "?") + carried;
}

function mdEsc(s: string): string {
  return s.replace(/([\\*_[\]~`|])/g, "\\$1");
}

function benefitLine(e: BenefitEntry, rich = false, custom = false): string {
  const shownPercent = e.percentShown ?? (e.percent === null ? null : Math.round(e.percent));
  const pct = shownPercent !== null && shownPercent > 0 ? ` (−${shownPercent} %)` : "";
  const was = e.wasPriceText ? `${e.wasPriceText} → ` : "";
  const name = e.note ? `${e.label} + ${e.note}` : e.label;
  if (!rich) return `${benefitEmoji(e, custom)} ${name} ${was}${e.priceText}${pct}`;
  const label = name.replace(/^(S kódem )([^\s`]+)$/, "$1`$2`");
  return `${benefitEmoji(e, custom)} ${label} ${was}**${e.priceText}**${pct}`;
}

const PARTIAL_NOTICE = "Některé ceny se nestihly načíst. Připiš za odkaz cokoliv (třeba písmeno) a pošli ho znovu.";

function stateText(p: ProductData): string {
  if (!p.condition) return p.availabilityText;
  return `${p.condition}, ${p.availabilityText.charAt(0).toLowerCase()}${p.availabilityText.slice(1)}`;
}

function componentEmbedJson(p: ProductData, canonical: string, img: string | null, carried: string, customEmoji: boolean): string | null {
  const titleUrl = carried ? outbound(canonical, carried) : canonical;
  const titleLine = `### **[${mdEsc(p.name)}](${titleUrl})** (${stateText(p)})`;
  const hasSale = (p.benefits ?? []).some((b) => b.kind === "sale");
  const priceLine =
    p.priceText && !hasSale ? `${customEmoji ? emojiMd("alza_price", "🏷️") : "🏷️"} Cena **${p.priceText}**` : null;
  const benefitLines = [
    ...(priceLine ? [priceLine] : []),
    ...(p.benefits ?? []).map((b) => benefitLine(b, true, customEmoji)),
    ...(p.partial ? [`-# ${PARTIAL_NOTICE}`] : []),
  ];
  const humanUrl = outbound(canonical, carried);
  const historyUrl = `https://www.hlidacshopu.cz/app/?url=${encodeURIComponent(canonical)}`;

  const desc = p.description ? mdEsc(p.description) : "";

  const build = (lines: string[], withThumb: boolean, withDesc = true): string => {
    const parts = ["-# Alza.cz", titleLine];
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
          ...(customEmoji && emojiRef("alza_logo") ? { emoji: emojiRef("alza_logo") } : {}),
        },
        ...(historyUrl.length <= 512 ? [{ type: 2, style: 5, url: historyUrl, label: "Hlídač shopů", ...(customEmoji ? { emoji: emojiRef("hlidac_shopu") ?? { name: "📈" } } : {}) }] : []),
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

function shortName(name: string, max = 70): string {
  if (name.length <= max) return name;
  const cut = name.slice(0, max);
  return cut.slice(0, Math.max(cut.lastIndexOf(" "), 40)).replace(/[\s,;:-]+$/, "") + "…";
}

function embedHtml(p: ProductData | null, path: string, stale: boolean, carried = "", missing = false, customEmoji = true): string {
  const slugged = slugTitle(path);
  const productId = /-d(\d+)\.htm$/i.exec(path)?.[1];
  const fallbackTitle = slugged === "Produkt" && productId ? `Produkt z Alzy (${productId})` : slugged;
  const canonical = p?.canonicalUrl ?? `https://www.alza.cz${path}`;

  const offers = (p?.benefits ?? []).filter((b) => b.kind === "sale" || b.kind === "coupon");
  const cheapest = offers.reduce<BenefitEntry | null>((best, b) => (best === null || b.price < best.price ? b : best), null);
  const titlePrice = p ? (cheapest && (p.price === null || cheapest.price < p.price) ? cheapest.priceText : p.priceText) : null;
  const title = p ? `${shortName(p.name)}${titlePrice ? ` | ${titlePrice}` : ""} (${stateText(p)})` : fallbackTitle;

  const DESC_MAX_BYTES = 330;
  const bytes = (t: string): number => Buffer.byteLength(t, "utf8");
  const parts: string[] = [];
  if (p) {
    if (p.priceText && !offers.some((b) => b.kind === "sale")) parts.push(p.priceText);
    for (const b of customEmoji ? offers : p.benefits ?? []) parts.push(benefitLine(b));
    if (stale) parts.push("data mohou být starší");
    if (p.partial) parts.push(PARTIAL_NOTICE);
  } else {
    parts.push(missing ? "Tenhle produkt na Alze už nenajdeme, odkaz je nejspíš neplatný." : "Produkt se nepodařilo načíst, zkus odkaz otevřít přímo na Alze.");
  }
  let desc = parts.join(" • ");
  if (p?.description) {
    const room = DESC_MAX_BYTES - bytes(desc) - (desc ? 3 : 0);
    let snippet = p.description;
    if (bytes(snippet) > room) {
      snippet = snippet.replace(/…$/, "");
      while (snippet.length > 0 && bytes(snippet) + 1 > room) snippet = snippet.slice(0, -4);
      snippet = snippet.slice(0, Math.max(snippet.lastIndexOf(" "), 0)).replace(/[\s,;:-]+$/, "") + "…";
    }
    if (snippet.length >= 30) desc = desc ? `${desc} • ${snippet}` : snippet;
  }

  const img = p?.image ? `${p.image}?width=${IMG_W}&height=${IMG_W}` : null;
  const componentJson = p && customEmoji ? componentEmbedJson(p, canonical, img, carried, true) : null;

  const tags = [
    `<meta charset="utf-8">`,
    `<title>${esc(title)} | ${p ? "Alza.cz" : "fxalza"}</title>`,
    `<meta property="og:type" content="product">`,
    `<meta property="og:site_name" content="${p ? "Alza.cz" : "fxalza"}">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta name="description" content="${esc(desc)}">`,
    `<meta property="og:description" content="${esc(desc)}">`,
    img ? `<meta property="og:image" content="${esc(img)}">` : "",
    img ? `<meta property="og:image:width" content="${IMG_W}">` : "",
    img ? `<meta property="og:image:height" content="${IMG_W}">` : "",
    customEmoji ? `<meta property="og:url" content="${esc(canonical)}">` : "",
    `<meta property="og:locale" content="cs_CZ">`,
    img ? `<meta property="og:image:alt" content="${esc(title)}">` : "",
    p?.price != null ? `<meta property="product:price:amount" content="${p.price}">` : "",
    p?.price != null ? `<meta property="product:price:currency" content="CZK">` : "",
    componentJson ? `<script id="discord:component-embed" type="application/json">${componentJson}</script>` : "",
    customEmoji ? `<meta http-equiv="refresh" content="0;url=${esc(outbound(canonical, carried))}">` : "",
    `<meta name="twitter:card" content="${img ? "summary_large_image" : "summary"}">`,
    `<meta name="twitter:title" content="${esc(title)}">`,
    `<meta name="twitter:description" content="${esc(desc)}">`,
    img ? `<meta name="twitter:image" content="${esc(img)}">` : "",
    `<meta name="theme-color" content="${p ? "#0f6fc5" : "#e5484d"}">`,
  ]
    .filter(Boolean)
    .join("\n  ");

  const benefitRows = (p?.benefits ?? []).map((e) => `<li>${esc(benefitLine(e))}</li>`);
  const bodyRows = [
    `<h1>${esc(title)}</h1>`,
    `<p>${esc(desc)}</p>`,
    benefitRows.length > 0 ? `<ul>${benefitRows.join("")}</ul>` : "",
    img ? `<img src="${esc(img)}" width="240" alt="">` : "",
    `<p><a href="${esc(outbound(canonical, carried))}">Přejít na Alza.cz</a></p>`,
    `<p class="note">${DISCLAIMER.replace("\n", " ")}</p>`,
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

function hostOf(req: http.IncomingMessage): string {
  return String(req.headers.host ?? "").replace(/:\d+$/, "").toLowerCase().slice(0, 60);
}

// Country comes from Cloudflare's header. The visitor id is a keyed hash of the address that changes whenever the server restarts; the address itself is never sent.
function visitorData(req: http.IncomingMessage, who: Requester): Record<string, string> {
  const country = String(req.headers["cf-ipcountry"] ?? "").toUpperCase();
  return { visitor: who.id, host: hostOf(req), ...(/^[A-Z]{2}$/.test(country) ? { country } : {}) };
}

const server = http.createServer(async (req, res) => {
  for (const [k, v] of Object.entries(BASE_HEADERS)) res.setHeader(k, v);
  const started = Date.now();
  const ua = String(req.headers["user-agent"] ?? "");
  const isBot = BOT_RE.test(ua);
  const who = identify(req, ua);
  if (who.unlisted) console.log(`[discord] Discordbot user agent from an address outside the published ranges (${who.id})`);
  let logged = "";
  let evt: TrackEvent | null = null;

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

    // The extension subdomains always land on the repository itself, whatever the path or query was.
    if (isExtensionHost(hostOf(req), APEX)) {
      evt = { url: "/extension", name: "extension_redirect", data: { host: hostOf(req), kind: isBot ? platformOf(ua) : "human" } };
      res.writeHead(302, { Location: EXTENSION_REPO, "cache-control": "no-store", vary: "Accept-Encoding, User-Agent" });
      res.end();
      return;
    }

    const host = String(req.headers.host ?? "").replace(/:d+$/, "").toLowerCase();
    if (!isBot && host.endsWith(`.${APEX}`) && !SERVED_SUBDOMAINS.has(host.slice(0, -APEX.length - 1))) {
      const p = parseProductPath(u.pathname, u.searchParams.get("dq"));
      res.writeHead(302, { Location: p ? outbound(`https://www.alza.cz${p.path}`, carriedQuery(u.searchParams)) : `${PUBLIC_URL}/`, "cache-control": "no-store", vary: "Accept-Encoding, User-Agent" });
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
        evt = { url: logged, name: "unsupported_domain", data: { tld, kind: isBot ? platformOf(ua) : "human" } };
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
    let parsed = parseProductPath(pathname, u.searchParams.get("dq"));
    if (!parsed && KOD_RE.test(pathname)) {
      const carried = carriedQuery(u.searchParams);
      if (!isBot) {
        evt = { url: "/kod", name: "click", data: { kind: "kod_list", ...visitorData(req, who) } };
        res.writeHead(302, { Location: outbound(`https://www.alza.cz${pathname}`, carried), "cache-control": "no-store", vary: "Accept-Encoding, User-Agent" });
        res.end();
        return;
      }
      const list = await getKodList(pathname, who);
      evt = { url: "/kod", name: "embed", data: { kind: "kod_list", platform: platformOf(ua), items: list?.items.length ?? 0, requested: kodCodes(pathname).length, state: list ? "ok" : "error", tier: rateTier(who), host: hostOf(req) } };
      if (!list) {
        sendProblem(req, res, isBot, 503, "Výpis se nepodařilo načíst", "Alza teď neodpovídá nebo je moc požadavků. Zkus to prosím za chvíli.", { "retry-after": "30" }, false);
        return;
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", vary: "Accept-Encoding, User-Agent" });
      res.end(req.method === "HEAD" ? undefined : kodHtml(list, pathname, carried, !who.telegram));
      return;
    }
    if (!parsed && isBot) parsed = await resolveSlug(pathname, who);
    if (!parsed) {
      if (pathname === "/" && !alza) {
        if (!isBot) evt = { url: "/", data: visitorData(req, who) };
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
        if (pathname.startsWith("/.well-known/")) {
          res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
          res.end("Not found\n");
        } else {
          evt = { url: logged, name: "not_found", data: { path: logged.slice(0, 100), kind: isBot ? platformOf(ua) : "human" } };
          sendProblem(
            req,
            res,
            isBot,
            404,
            "Tohle není odkaz na produkt z Alzy",
            "Odkaz na produkt na Alze končí na -d1234567.htm. V takovém odkazu změň alza.cz na fxalza.cz a Discord ukáže náhled.",
          );
        }
      }
      return;
    }

    if (u.searchParams.get("format") === "json") {
      const { data, stale, limited, missing } = await getProduct(parsed.id, parsed.path, who);
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
      res.writeHead(data ? 200 : missing ? 404 : 503, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": data ? "public, max-age=60, stale-while-revalidate=300" : "no-store",
        ...CORS_HEADERS,
        "access-control-expose-headers": "content-length",
      });
      res.end(req.method === "HEAD" ? undefined : body);
      return;
    }

    if (!isBot) {
      const known = getCached(parsed.id, true);
      const target = outbound(known?.canonicalUrl ?? `https://www.alza.cz${parsed.path}`, carriedQuery(u.searchParams));
      evt = { url: `/product/${parsed.id}`, name: "click", data: { product: parsed.id, ...(known ? { name: shortName(known.name, 80) } : {}), ...visitorData(req, who) } };
      res.writeHead(302, { Location: target, "cache-control": "no-store", vary: "Accept-Encoding, User-Agent" });
      res.end();
      return;
    }

    const trace: { cache?: string } = {};
    const bust = hasCacheBustSuffix(pathname);
    const { data, stale, limited, missing } = await getProduct(parsed.id, parsed.path, who, bust, trace);
    const state = limited ? "limited" : !data ? (missing ? "missing" : "error") : data.partial ? "partial" : stale ? "stale" : "ok";
    evt = {
      url: `/product/${parsed.id}`,
      name: "embed",
      data: {
        platform: platformOf(ua),
        product: parsed.id,
        ...(data ? { name: shortName(data.name, 80), ...(data.brand ? { brand: data.brand } : {}), benefits: data.benefits?.length ?? 0 } : {}),
        host: hostOf(req),
        state,
        cache: trace.cache ?? "miss",
        tier: rateTier(who),
        bust,
        ...(who.unlisted ? { spoofed_discord: true } : {}),
      },
    };
    if (limited) {
      sendProblem(req, res, isBot, 429, "Moc požadavků najednou", "Náhled se teď načítá pro hodně odkazů. Zkus to prosím za chvíli.", { "retry-after": "60" }, false);
      return;
    }
    if (!data && !missing) {
      sendProblem(req, res, isBot, 503, "Náhled se nepodařilo načíst", "Alza teď neodpovídá nebo je moc požadavků. Zkus to prosím za chvíli.", { "retry-after": "30" }, false);
      return;
    }
    const html = embedHtml(data, parsed.path, stale, carriedQuery(u.searchParams), missing, !who.telegram);
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      vary: "Accept-Encoding, User-Agent",
    });
    res.end(req.method === "HEAD" ? undefined : html);
  } catch (e) {
    console.error("[server] error:", e);
    let fallback: Parsed | null = null;
    let fallbackQuery = "";
    try {
      const requested = new URL(req.url ?? "/", "http://localhost");
      fallback = parseProductPath(requested.pathname, requested.searchParams.get("dq"));
      fallbackQuery = carriedQuery(requested.searchParams);
    } catch {
      fallback = null;
    }
    if (!res.headersSent && !isBot && fallback) {
      res.writeHead(302, { Location: outbound(`https://www.alza.cz${fallback.path}`, fallbackQuery), "cache-control": "no-store", vary: "Accept-Encoding, User-Agent" });
      res.end();
    } else if (!res.headersSent) {
      sendProblem(req, res, isBot, 503, "Něco se pokazilo", "Náhled se teď nepodařilo vytvořit. Zkus to prosím za chvíli.", { "retry-after": "30" }, false);
    } else {
      res.end();
    }
  } finally {
    const ms = Date.now() - started;
    console.log(`${new Date().toISOString()} ${isBot ? "bot " : "human"} ${res.statusCode} ${ms}ms ${logged} (${ua.slice(0, 40)})`);
    if (evt && req.method === "GET") {
      track({
        ...evt,
        data: { ...evt.data, status: res.statusCode, ms },
        ...(isBot ? {} : { visitorUa: ua, referrer: String(req.headers.referer ?? ""), language: String(req.headers["accept-language"] ?? "").split(",")[0], ip: anonymizedIp(req) }),
      });
    }
  }
});

server.headersTimeout = 15_000;
server.requestTimeout = 20_000;
server.keepAliveTimeout = 65_000;
server.maxConnections = Number(process.env.MAX_CONNECTIONS ?? 2000);

process.on("unhandledRejection", (reason) => {
  console.error("[process] unhandled rejection:", reason);
});
process.on("uncaughtException", (e) => {
  console.error("[process] uncaught exception, exiting for a restart:", e);
  flushCache();
  stopSidecar();
  process.exit(1);
});

// The first requests through a cold sidecar get 403 from Alza and push the first real embed past its deadline, so a couple of products are fetched once the server is up.
// They are the ones of the landing page demo, so those links come out of a fresh cache too. WARMUP_IDS= (empty) turns it off.
const WARMUP_IDS = (process.env.WARMUP_IDS ?? "13067221,7356338").split(",").map((s) => s.trim()).filter(Boolean);

async function warmUp(): Promise<void> {
  for (const id of WARMUP_IDS) {
    const started = Date.now();
    try {
      await refresh(id, `/-d${id}.htm`);
      console.log(`[warmup] ${id} ok in ${Date.now() - started}ms`);
    } catch (e) {
      console.log(`[warmup] ${id} failed after ${Date.now() - started}ms: ${e instanceof Error ? e.message : e}`);
    }
  }
}

server.listen(PORT, HOST, () => {
  console.log(`[server] fxalza listening on http://${HOST}:${PORT}`);
  void warmUp();
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
