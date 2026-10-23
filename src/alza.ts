import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { track } from "./analytics.ts";
import { fetchUrl } from "./fetcher.ts";
import { texts } from "./i18n.ts";
import { kodCodes, parseKodList, type KodItem, type KodList } from "./kodlist.ts";
import { parseProductPath, type Parsed } from "./parse.ts";
import { CZ, formatMoney, type Shop, type ShopCode } from "./shops.ts";

export { stopSidecar } from "./fetcher.ts";

export interface BenefitEntry {
  kind: "sale" | "coupon" | "alzaplus" | "cashback" | "tradein" | "promo" | "tier";
  label: string;
  price: number;
  priceText: string;
  percent: number | null;
  percentShown: number | null;
  wasPriceText?: string;
  note?: string;
  // the code of a coupon, so the line can set it in monospace whatever the language of the label
  coupon?: string;
}

export interface ProductData {
  id: string;
  name: string;
  price: number | null;
  priceText: string | null;
  availability: string;
  availabilityText: string;
  condition?: string;
  rating: number | null;
  ratingCount: number | null;
  brand: string | null;
  description?: string;
  image: string | null;
  canonicalUrl: string;
  benefits: BenefitEntry[];
  partial?: true;
  fetchedAt: string;
  // the shop the product was read from, a missing value means Alza.cz
  shop?: ShopCode;
}

const BENEFITS_ENABLED = process.env.BENEFITS !== "0";
const BENEFITS_GRACE_MS = Number(process.env.BENEFITS_GRACE_MS ?? 1500);

export interface TierDef {
  name: string;
  pgrik: string;
  reference?: boolean;
}

export const TIERS: TierDef[] = [
  { name: "Gold", pgrik: "p_pg4_e6c95" },
  { name: "Silver", pgrik: "p_pg3_36eef" },
  { name: "ISIC", pgrik: "p_pg3is1_2b2fc" },
  { name: "Bronze", pgrik: "p_pg5_44266" },
  { name: "B2B", pgrik: "p_pg6_6ce49" },
  { name: "Basic", pgrik: "p__26752", reference: true },
];

// ISIC is left out where the shop has no such price list.
export function tiersFor(shop: Shop): TierDef[] {
  return shop.hasIsic ? TIERS : TIERS.filter((t) => t.name !== "ISIC");
}

export interface PriceCandidate {
  amount: number;
  // primaryPrice is whole crowns as printed; Alza works out its discount labels from this exact value
  exact?: number;
  promo: boolean;
  priceType: number | null;
  name: string;
  coupon: string;
}

export interface TierResult {
  tier: string;
  hidden: boolean;
  selected: PriceCandidate | null;
  main: PriceCandidate | null;
  promos: PriceCandidate[];
  compare?: number;
}

function findPricingNode(node: unknown, depth = 0): any | null {
  if (!node || typeof node !== "object" || depth > 30) return null;
  const n = node as Record<string, any>;
  if (n.mainPriceTag || Array.isArray(n.promoPrices)) return n;
  for (const child of Object.values(n)) {
    const r = findPricingNode(child, depth + 1);
    if (r) return r;
  }
  return null;
}

function priceCandidate(v: any, promo = false): PriceCandidate | null {
  if (!v || !["string", "number"].includes(typeof v.primaryPrice)) return null;
  const price = String(v.primaryPrice).trim();
  let numeric = price
    .replace(/\s/g, "")
    .replace(/(?:Kč|CZK|€|EUR|Ft|HUF)$/i, "")
    .replace(/[,.][-–—]$/, "");
  if (/^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(numeric)) numeric = numeric.replace(/\./g, "");
  if (!/^\d+(?:[,.]\d{1,2})?$/.test(numeric)) return null;
  const amount = Number(numeric.replace(",", "."));
  if (!Number.isFinite(amount)) return null;
  return {
    amount,
    // only trusted while it agrees with the printed price, anything else is not this price in crowns
    ...(typeof v.primaryPriceNoCurrency === "number" && Math.abs(v.primaryPriceNoCurrency - amount) <= 1 ? { exact: v.primaryPriceNoCurrency } : {}),
    promo,
    priceType: typeof v.priceType === "number" ? v.priceType : null,
    name: promo && typeof v.name === "string" ? v.name.trim() : "",
    coupon: promo && typeof v.discountCouponCode === "string" ? v.discountCouponCode.trim() : "",
  };
}

function computeTier(pricing: any, reference: boolean): Omit<TierResult, "tier"> {
  const main = pricing.mainPriceTag;
  if (!reference && main?.priceGroupType === 0 && main.priceType !== 7) {
    return { hidden: true, selected: null, main: null, promos: [] };
  }
  const mainCandidate = priceCandidate(main);
  let selected = mainCandidate;
  const promos: PriceCandidate[] = [];
  for (const promo of Array.isArray(pricing.promoPrices) ? pricing.promoPrices : []) {
    const next = priceCandidate(promo, true);
    if (!next) continue;
    promos.push(next);
    if (!selected || next.amount < selected.amount) selected = next;
  }
  const compare = priceCandidate({ primaryPrice: main?.comparePrice });
  const discountBase = compare || (selected?.promo ? mainCandidate : null);
  if (!reference && (main?.priceType === 7 || main?.priceType === 4)) {
    if (!selected || !discountBase || selected.amount === discountBase.amount) {
      return { hidden: true, selected: null, main: mainCandidate, promos, ...(compare ? { compare: compare.amount } : {}) };
    }
  }
  return { hidden: false, selected, main: mainCandidate, promos, ...(compare ? { compare: compare.amount } : {}) };
}

export async function fetchTier(id: string, tier: TierDef, shop: Shop = CZ): Promise<TierResult | null> {
  const url = `https://webapi.alza.cz/api/commodity/v1/${id}/detailPriceInfoV3?country=${shop.country}&pgrik=${tier.pgrik}&ucik=null`;
  let res;
  try {
    res = await fetchUrl(url, {
      headers: { Accept: "application/json, text/html;q=0.9" },
      timeoutMs: 8000,
      prefer: ["firecrawl"],
      country: shop.country,
    });
  } catch {
    return null;
  }
  if (res.status !== 200) return null;
  let data: unknown;
  try {
    data = JSON.parse(res.body);
  } catch {
    return null;
  }
  const pricing = findPricingNode(data);
  if (!pricing) return null;
  return { tier: tier.name, ...computeTier(pricing, !!tier.reference) };
}

function promoTag(c: PriceCandidate, shop: Shop): string {
  const t = texts(shop.lang);
  if (c.priceType === 4) return "AlzaPlus+";
  if (c.coupon) return t.tagCoupon;
  if (c.priceType === 2) return t.tagTradein;
  if (c.priceType === 1) return t.tagCashback;
  return c.name || t.tagPromo;
}

interface BenefitsResult {
  entries: BenefitEntry[];
  complete: boolean;
  later?: Promise<BenefitsResult>;
}

const TIER_SOFT_MS = Number(process.env.TIER_SOFT_MS ?? 1200);
const LEAN_TIERS = process.env.TIERS_LEAN !== "0";
const CLUB_FOLLOWERS = ["Silver", "Bronze"];
const firstTiers = (shop: Shop): TierDef[] => (LEAN_TIERS ? tiersFor(shop).filter((t) => !CLUB_FOLLOWERS.includes(t.name)) : tiersFor(shop));

function clubPriceVisible(t: TierResult | undefined, base: number | null): boolean {
  return !!t && !t.hidden && !!t.main && !!t.selected && base !== null && t.main.amount < base - 0.004;
}

// Gold, Silver and Bronze are the club, so Silver and Bronze only have a price when Gold has one
// (49 of 49 sampled products without a Gold price had none). ISIC and B2B are separate programs
// with prices of their own, so they are always fetched and never copied into Silver or Bronze.
export function followerTiers(byTier: Map<string, TierResult>): string[] {
  if (!LEAN_TIERS) return [];
  return clubPriceVisible(byTier.get("Gold"), byTier.get("Basic")?.main?.amount ?? null) ? CLUB_FOLLOWERS : [];
}

async function fetchBenefits(shop: Shop, id: string): Promise<BenefitsResult> {
  const byTier = new Map<string, TierResult>();
  const load = (t: TierDef): Promise<void> =>
    fetchTier(id, t, shop)
      .then((r) => {
        if (r) byTier.set(r.tier, r);
      })
      .catch(() => {});
  const done = (m: Map<string, TierResult>): BenefitsResult => ({
    ...buildBenefits(m, shop),
    complete: firstTiers(shop).every((t) => m.has(t.name)) && followerTiers(m).every((n) => m.has(n)),
  });
  const all = (async () => {
    await Promise.all(firstTiers(shop).map(load));
    await Promise.all(tiersFor(shop).filter((t) => followerTiers(byTier).includes(t.name)).map(load));
  })();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const inTime = await Promise.race([
    all.then(() => true),
    new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), TIER_SOFT_MS);
    }),
  ]);
  clearTimeout(timer);
  if (inTime) return done(byTier);
  const early = done(new Map(byTier));
  console.log(`[benefits] ${id} ${byTier.size} tiers after ${TIER_SOFT_MS}ms, the rest follows`);
  return { ...early, later: all.then(() => done(byTier)) };
}

// Alza's API gives ISIC the very same cashback price as Basic, so the ISIC discount is lost. When ISIC has a list price of its own and both
// carry a cashback of the same amount, the price is worked out like for the other tiers: the ISIC price minus the cashback Basic gets.
// The Alza-Benefit-Prices extension does the same.
function isicCashback(isic: TierResult, basic: TierResult | undefined, shop: Shop): PriceCandidate | null {
  const mine = isic.selected;
  const theirs = basic?.selected;
  if (!mine || !theirs || !isic.main || !basic?.main) return null;
  if (!(mine.promo && mine.priceType === 1 && theirs.promo && theirs.priceType === 1 && mine.amount === theirs.amount)) return null;
  if (!(isic.main.amount > 0 && basic.main.amount > 0 && isic.main.amount < basic.main.amount)) return null;
  const cashback = basic.main.amount - theirs.amount;
  const raw = isic.main.amount - cashback;
  if (!(cashback > 0 && raw > 0)) return null;
  return { amount: shop.currency === "EUR" ? Math.round(raw * 100) / 100 : Math.round(raw), promo: true, priceType: 1, name: mine.name, coupon: "" };
}

export function buildBenefits(byTier: Map<string, TierResult>, shop: Shop = CZ): BenefitsResult {
  const t = texts(shop.lang);
  const money = (n: number): string => formatMoney(shop, n, true);
  const basic = byTier.get("Basic");
  const base = basic?.main?.amount ?? null;
  const entries: BenefitEntry[] = [];
  const percent = (amount: number): number | null =>
    base && base > amount ? ((base - amount) / base) * 100 : null;
  const shown = (amount: number, denominator: number | null = base): number | null => {
    const exact = denominator && denominator > amount ? ((denominator - amount) / denominator) * 100 : null;
    // the printed prices are rounded to whole crowns or forints, euros to the cent, and the exact discount can be half a unit off
    const half = shop.currency === "EUR" ? 0.005 : 0.5;
    return exact === null ? null : Math.floor(exact + (half * 100) / denominator! + 1e-9);
  };
  // The club labels on Alza ("Gold Sleva -8 %") cut the exact discount to whole percent, measured from the crossed out price when the product is on sale.
  const clubBase = basic?.compare && base && basic.compare > base + 0.004 ? basic.compare : (basic?.main?.exact ?? base);
  const clubShown = (amount: number): number | null =>
    clubBase && clubBase > amount ? Math.floor(((clubBase - amount) / clubBase) * 100 + 1e-9) : null;

  if (basic?.compare && base && basic.compare > base + 0.004) {
    entries.push({
      kind: "sale",
      label: t.sale,
      price: base,
      priceText: money(base),
      percent: ((basic.compare - base) / basic.compare) * 100,
      percentShown: shown(base, basic.compare),
      wasPriceText: money(basic.compare),
    });
  }

  // Alza names its promotions in Czech in every shop. Czech keeps the name as it comes, the others say the standard ones in their own language.
  const own = (name: string, local: string, keep = false): string => (shop.code === "cz" || keep ? name || local : local);
  for (const pr of basic?.promos ?? []) {
    if (!(base && pr.amount < base - 0.004)) continue;
    let kind: BenefitEntry["kind"];
    let label: string;
    if (pr.priceType === 4) {
      kind = "alzaplus";
      label = t.alzaplus;
    } else if (pr.coupon) {
      kind = "coupon";
      label = t.couponLabel(pr.coupon);
    } else if (pr.priceType === 2) {
      kind = "tradein";
      label = own(pr.name, t.tradein);
    } else if (pr.priceType === 1) {
      kind = "cashback";
      label = own(pr.name, t.cashback);
    } else {
      kind = "promo";
      // a promotion with a name of its own keeps it, the standard Czech one is said in the language of the shop
      label = pr.name && pr.name !== texts("cs").promo ? own(pr.name, t.promo, true) : t.promo;
    }
    const fromCode = kind === "coupon" ? Number(/(\d{1,2})$/.exec(pr.coupon ?? "")?.[1]) : NaN;
    const calculated = shown(pr.amount);
    const percentShown = Number.isFinite(fromCode) && calculated !== null && Math.abs(fromCode - calculated) <= 1 ? fromCode : calculated;
    entries.push({ kind, label, price: pr.amount, priceText: money(pr.amount), percent: percent(pr.amount), percentShown, ...(kind === "coupon" ? { coupon: pr.coupon } : {}) });
  }

  interface ClubRow {
    names: string[];
    listPrice: number;
    best: number;
    bestExact: number;
    promo: PriceCandidate | null;
  }
  const rows: ClubRow[] = [];
  for (const name of ["Gold", "Silver", "ISIC", "Bronze", "B2B"]) {
    const t = byTier.get(name);
    if (!t || t.hidden || !t.main || !t.selected) continue;
    if (!(base && t.main.amount < base - 0.004)) continue;
    const selected = (name === "ISIC" ? isicCashback(t, basic, shop) : null) ?? t.selected;
    const lowered = selected.amount < t.main.amount - 0.004;
    rows.push({
      names: [name],
      listPrice: t.main.amount,
      best: selected.amount,
      bestExact: selected.exact ?? selected.amount,
      promo: lowered ? selected : null,
    });
  }

  // The B2B price group is Bronze plus B2B, so a B2B price equal to Bronze's carries no information of its own.
  const bronze = rows.find((r) => r.names[0] === "Bronze");
  const b2b = rows.findIndex((r) => r.names[0] === "B2B");
  if (bronze && b2b >= 0 && Math.abs(bronze.listPrice - rows[b2b]!.listPrice) < 0.005 && Math.abs(bronze.best - rows[b2b]!.best) < 0.005) {
    rows.splice(b2b, 1);
  }

  // tiers that end up with the very same price share one line, in the order Gold, Silver, ISIC, Bronze, B2B
  for (let i = 0; i < rows.length; i++) {
    for (let j = rows.length - 1; j > i; j--) {
      const x = rows[i]!, y = rows[j]!;
      if (Math.abs(x.listPrice - y.listPrice) < 0.005 && Math.abs(x.best - y.best) < 0.005 && Math.abs(x.bestExact - y.bestExact) < 0.005) {
        x.names = x.names.concat(y.names);
        rows.splice(j, 1);
      }
    }
  }
  const CLUB_ORDER = ["Gold", "Silver", "ISIC", "Bronze", "B2B"];
  for (const r of rows) r.names.sort((p, q) => CLUB_ORDER.indexOf(p) - CLUB_ORDER.indexOf(q));

  for (const r of rows) {
    entries.push({
      kind: "tier",
      label: r.names.join("/"),
      price: r.best,
      priceText: money(r.best),
      percent: percent(r.best),
      percentShown: clubShown(r.bestExact),
      ...(r.promo ? { wasPriceText: money(r.listPrice), note: promoTag(r.promo, shop) } : {}),
    });
  }

  const KIND_ORDER: Record<BenefitEntry["kind"], number> = {
    sale: -1,
    coupon: 0,
    alzaplus: 1,
    cashback: 2,
    tradein: 3,
    promo: 4,
    tier: 5,
  };
  entries.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.price - b.price);
  return { entries: entries.slice(0, 8), complete: byTier.size === tiersFor(shop).length };
}

// Schema.org reports an incoming shipment as InStock, because it can already be ordered. The stock label is what the page shows.
// A quantity ("Na cestě > 5 ks") or a date ("Očekáváme 29. října 2026", "Erwartet: 29. Oktober 2026") rides on that label. Neither is part of the status.
const STOCK_STATUS: Record<Shop["lang"], [RegExp, string][]> = {
  cs: [
    [/očekáváme/i, "Expected"],
    [/na cestě/i, "OnTheWay"],
  ],
  sk: [
    [/očakávame/i, "Expected"],
    [/na ceste/i, "OnTheWay"],
  ],
  hu: [
    [/várható/i, "Expected"],
    [/úton/i, "OnTheWay"],
  ],
  de: [
    [/erwartet/i, "Expected"],
    [/unterwegs/i, "OnTheWay"],
  ],
};

export function availabilityKey(schemaAvailability: unknown, html: string, shop: Shop = CZ): string {
  const schema = schemaAvailability ? String(schemaAvailability).split("/").pop()! : "unknown";
  for (const m of html.matchAll(/class="stcStock[^"]*"[^>]*title="([^"]*)"/gi)) {
    const title = decodeEntities(m[1]!);
    for (const [re, key] of STOCK_STATUS[shop.lang]) if (re.test(title)) return key;
  }
  return schema;
}

// JSON-LD itemCondition says whether it is second hand, the grade is only in the stock label.
// The Czech page names the grade in Czech; the other shops are only told apart as used.
export function conditionText(itemCondition: unknown, html: string, shop: Shop = CZ): string | null {
  const t = texts(shop.lang);
  const kind = String(itemCondition ?? "").split("/").pop();
  if (kind === "RefurbishedCondition") return t.refurbished;
  if (kind === "DamagedCondition") return t.damaged;
  if (kind !== "UsedCondition") return null;
  const grade = shop.code === "cz" ? /class="stcStock[^"]*"[^>]*title="\s*(Rozbaleno|Zánovní|Použité)/.exec(html)?.[1] : undefined;
  return grade ?? t.used;
}

export class UpstreamError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function httpsUrlOn(value: string, domain: string): string | null {
  try {
    const u = new URL(value);
    const host = u.hostname.toLowerCase();
    return u.protocol === "https:" && (host === domain || host.endsWith(`.${domain}`)) ? u.toString() : null;
  } catch {
    return null;
  }
}

async function getHtml(shop: Shop, path: string): Promise<string> {
  const res = await fetchUrl(`https://${shop.host}${path}`, {
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": `${shop.locale},${shop.lang};q=0.9,en;q=0.8`,
    },
    timeoutMs: 25000,
    country: shop.country,
  });
  if (res.status !== 200) throw new UpstreamError(res.status, `alza responded HTTP ${res.status} (via ${res.via})`);
  return res.body;
}

function findProductNode(node: any): any | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const r = findProductNode(n);
      if (r) return r;
    }
    return null;
  }
  const t = node["@type"];
  if (t === "Product" || (Array.isArray(t) && t.includes("Product"))) return node;
  if (node["@graph"]) {
    const r = findProductNode(node["@graph"]);
    if (r) return r;
  }
  if (node.mainEntity) {
    const r = findProductNode(node.mainEntity);
    if (r) return r;
  }
  return null;
}

function extractProductJsonLd(html: string): any | null {
  const re = /<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(re)) {
    try {
      const node = findProductNode(JSON.parse(m[1]!));
      if (node) return node;
    } catch {
    }
  }
  return null;
}

// A page that parses to nothing is kept (the newest few) under data/debug, so its real markup can be looked at.
function dumpUnparsed(kind: string, pathname: string, html: string): void {
  const count = (needle: string): number => html.split(needle).length - 1;
  console.warn(
    `[${kind}] nothing parsed from ${pathname}: ${html.length} bytes, box-row=${count('class="box-row"')}, js-box-link=${count("js-box-link")}, ` +
      `"Objednací kód"=${count("Objednací kód")}, "-d"=${count(".htm")}, title=${JSON.stringify(/<title>([^<]{0,80})/i.exec(html)?.[1]?.trim() ?? "")}`,
  );
  try {
    const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../data/debug");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${kind}-${Date.now()}.html`), html.slice(0, 600_000));
    const old = fs.readdirSync(dir).filter((f) => f.startsWith(`${kind}-`)).sort().slice(0, -5);
    for (const f of old) fs.rmSync(path.join(dir, f), { force: true });
  } catch {
  }
}

const KOD_ITEMS_MAX = 12;
const KOD_PARALLEL = 4;

// /kod/<one code> redirects to that product's page, so a listing can also be put together from one request per code.
async function fetchKodItem(code: string): Promise<KodItem | null> {
  const html = await getHtml(CZ, `/kod/${code}`);
  const p = extractProductJsonLd(html);
  if (!p) return null;
  const offers = Array.isArray(p.offers) ? p.offers[0] : p.offers;
  const claimed = offers?.url ? String(offers.url) : typeof p["@id"] === "string" ? String(p["@id"]).replace(/#.*$/, "") : null;
  const url = claimed && httpsUrlOn(claimed, "alza.cz");
  const id = url ? parseProductPath(new URL(url).pathname)?.id : undefined;
  const name = p.name ? decodeEntities(String(p.name)) : "";
  if (!url || !id || !name) return null;
  const raw = offers?.price === undefined || offers?.price === null ? NaN : typeof offers.price === "number" ? offers.price : Number(String(offers.price).replace(",", "."));
  const price = Number.isFinite(raw) && raw > 0 ? raw : null;
  const im = Array.isArray(p.image) ? (typeof p.image[0] === "string" ? p.image[0] : p.image[0]?.url) : typeof p.image === "string" ? p.image : p.image?.url;
  const image = typeof im === "string" ? httpsUrlOn(im, "alza.cz") : null;
  return {
    id,
    name,
    url: url.split("?")[0]!,
    price,
    priceText: price === null ? null : formatMoney(CZ, price),
    wasText: null,
    availability: texts(CZ.lang).availability[availabilityKey(offers?.availability, html, CZ)] ?? null,
    image: image ? image.split("?")[0]! : null,
  };
}

async function fetchKodByCodes(codes: string[]): Promise<KodList | null> {
  const wanted = codes.slice(0, KOD_ITEMS_MAX);
  const items: (KodItem | null)[] = new Array(wanted.length).fill(null);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(KOD_PARALLEL, wanted.length) }, async () => {
      while (next < wanted.length) {
        const i = next++;
        items[i] = await fetchKodItem(wanted[i]!).catch((e) => {
          console.warn(`[kod] code ${wanted[i]} not read: ${e instanceof Error ? e.message : e}`);
          return null;
        });
      }
    }),
  );
  const found = items.filter((i): i is KodItem => i !== null);
  if (found.length === 0) return null;
  return { items: found, requested: codes.length, total: found.reduce((sum, i) => sum + (i.price ?? 0), 0) };
}

export async function fetchKodList(pathname: string, requested: number): Promise<KodList | null> {
  const html = await getHtml(CZ, pathname);
  const list = parseKodList(html, requested);
  if (list) return list;
  dumpUnparsed("kod", pathname, html);
  console.log(`[kod] falling back to one request per code for ${pathname}`);
  return fetchKodByCodes(kodCodes(pathname));
}

// Alza redirects a bare slug such as /gaming/hogwarts-legacy to one concrete product page; its JSON-LD names the canonical -d<id> link.
export async function resolveProductPath(path: string, shop: Shop = CZ): Promise<Parsed | null> {
  const p = extractProductJsonLd(await getHtml(shop, path));
  if (!p) return null;
  const offers = Array.isArray(p.offers) ? p.offers[0] : p.offers;
  const claimed = offers?.url ? String(offers.url) : typeof p["@id"] === "string" ? String(p["@id"]).replace(/#.*$/, "") : null;
  const url = claimed && httpsUrlOn(claimed, `alza.${shop.tld}`);
  return url ? parseProductPath(new URL(url).pathname) : null;
}

export function slugTitle(path: string): string {
  const seg = path.split("?")[0]!.split("/").filter(Boolean).pop() ?? path;
  let s = seg.replace(/\.htm$/i, "").replace(/-d\d+$/i, "");
  s = s.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return "Produkt";
  s = s
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  s = s.replace(/\b(\d+)\s*(gb|tb|mb|kb|kg|mm|cm|hz|w)\b/gi, (_all, n: string, u: string) => `${n} ${u.toUpperCase()}`);
  return s;
}

const HTML_ENTITIES: Record<string, string> = { quot: '"', amp: "&", lt: "<", gt: ">", apos: "'", nbsp: " " };

function decodeEntities(t: string): string {
  return t.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (m, dec?: string, hex?: string, name?: string) =>
    dec ? String.fromCodePoint(Number(dec)) : hex ? String.fromCodePoint(parseInt(hex, 16)) : (HTML_ENTITIES[name!.toLowerCase()] ?? m),
  );
}

function cleanDescription(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const t = decodeEntities(raw.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
  if (t.length < 8) return undefined;
  if (t.length <= 160) return t;
  const cut = t.slice(0, 160);
  const comma = cut.lastIndexOf(",");
  const at = comma > 60 ? comma : cut.lastIndexOf(" ");
  return cut.slice(0, at > 60 ? at : 160).replace(/[\s,;:–-]+$/, "") + "…";
}

export async function fetchProduct(
  id: string,
  path: string,
  onLateBenefits?: (benefits: BenefitEntry[], complete: boolean) => void,
  shop: Shop = CZ,
): Promise<ProductData> {
  const t = texts(shop.lang);
  const benefitsStarted = Date.now();
  // The id is already known from the link, so the price tiers load while the page itself is still on its way.
  const benefitsPromise: Promise<BenefitsResult> = BENEFITS_ENABLED
    ? fetchBenefits(shop, id).catch((e) => {
        console.error(`[benefits] ${id}: ${e instanceof Error ? e.message : e}`);
        return { entries: [], complete: false };
      })
    : Promise.resolve({ entries: [], complete: true });

  const html = await getHtml(shop, path);
  const p = extractProductJsonLd(html);
  if (!p) throw new Error("no Product JSON-LD found on the page");

  const offers = Array.isArray(p.offers) ? p.offers[0] : p.offers;

  let price: number | null = null;
  if (offers && offers.price !== undefined && offers.price !== null) {
    const v = typeof offers.price === "number" ? offers.price : Number(String(offers.price).replace(",", "."));
    if (Number.isFinite(v) && v > 0) price = v;
  }

  let rating: number | null = null;
  let ratingCount: number | null = null;
  if (p.aggregateRating) {
    const rv = Number(p.aggregateRating.ratingValue);
    if (Number.isFinite(rv)) rating = rv;
    const rc = Number(p.aggregateRating.ratingCount ?? p.aggregateRating.reviewCount);
    if (Number.isFinite(rc)) ratingCount = rc;
  }

  let image: string | null = null;
  const im = p.image;
  if (Array.isArray(im) && im.length > 0) {
    const first = im[0];
    image = typeof first === "string" ? first : (first?.url ?? null);
  } else if (typeof im === "string") {
    image = im;
  } else if (im?.url) {
    image = String(im.url);
  }

  const condition = conditionText(offers?.itemCondition, html, shop);
  const availability = availabilityKey(offers?.availability, html, shop);

  const claimed = offers?.url ? String(offers.url) : typeof p["@id"] === "string" ? String(p["@id"]).replace(/#.*$/, "") : null;
  const canonicalUrl = (claimed && httpsUrlOn(claimed, `alza.${shop.tld}`)) || `https://${shop.host}${path}`;
  if (image && !httpsUrlOn(image, "alza.cz") && !httpsUrlOn(image, `alza.${shop.tld}`)) image = null;

  let benefits: BenefitEntry[] = [];
  let partial = true;
  let grace: ReturnType<typeof setTimeout> | undefined;
  const ready = await Promise.race([
    benefitsPromise.then((b) => ({ b })),
    new Promise<null>((resolve) => {
      grace = setTimeout(() => resolve(null), BENEFITS_GRACE_MS);
    }),
  ]);
  clearTimeout(grace);
  if (ready) {
    benefits = ready.b.entries;
    partial = !ready.b.complete;
    track({ url: "/benefits", name: "benefits", data: { outcome: "in_time", ms: Date.now() - benefitsStarted, entries: ready.b.entries.length, complete: ready.b.complete } });
    void ready.b.later?.then((l) => {
      console.log(`[benefits] ${id} completed late (${l.entries.length})`);
      onLateBenefits?.(l.entries, l.complete);
    });
  }
  else {
    console.log(`[benefits] ${id} not ready after ${BENEFITS_GRACE_MS}ms, answering without them`);
    void benefitsPromise.then((b) => {
      if (b.entries.length > 0 || b.complete) {
        console.log(`[benefits] ${id} arrived late (${b.entries.length})`);
        track({ url: "/benefits", name: "benefits", data: { outcome: "late", ms: Date.now() - benefitsStarted, entries: b.entries.length, complete: b.complete } });
        onLateBenefits?.(b.entries, b.complete);
      }
      void b.later?.then((l) => onLateBenefits?.(l.entries, l.complete));
    });
  }

  return {
    id,
    name: decodeEntities(String(p.name ?? slugTitle(path))),
    price,
    priceText: price === null ? null : formatMoney(shop, price),
    availability,
    availabilityText: t.availability[availability] ?? t.unknownAvailability,
    ...(condition ? { condition } : {}),
    rating,
    ratingCount,
    brand: p.brand?.name ? String(p.brand.name) : null,
    ...(cleanDescription(p.description) ? { description: cleanDescription(p.description)! } : {}),
    image,
    canonicalUrl,
    benefits,
    ...(partial ? { partial: true as const } : {}),
    fetchedAt: new Date().toISOString(),
    ...(shop.code === "cz" ? {} : { shop: shop.code }),
  };
}
