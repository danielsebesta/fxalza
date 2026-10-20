import { fetchUrl } from "./fetcher.ts";

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
}

const AVAILABILITY_CS: Record<string, string> = {
  InStock: "Skladem",
  OutOfStock: "Není skladem",
  PreOrder: "Předprodej",
  PreSale: "Předprodej",
  BackOrder: "Na objednávku",
  LimitedAvailability: "Poslední kusy",
  InStoreOnly: "Jen na prodejně",
  SoldOut: "Vyprodáno",
  OnlineOnly: "Jen online",
  Discontinued: "Prodej skončil",
};

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

export interface PriceCandidate {
  amount: number;
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

export async function fetchTier(id: string, tier: TierDef): Promise<TierResult | null> {
  const url = `https://webapi.alza.cz/api/commodity/v1/${id}/detailPriceInfoV3?country=CZ&pgrik=${tier.pgrik}&ucik=null`;
  let res;
  try {
    res = await fetchUrl(url, {
      headers: { Accept: "application/json, text/html;q=0.9" },
      timeoutMs: 8000,
      prefer: ["firecrawl"],
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

function fmtCzk2(n: number): string {
  return new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 2 }).format(n).replace(/\u00A0/g, " ") + " Kč";
}

function promoTag(c: PriceCandidate): string {
  if (c.priceType === 4) return "AlzaPlus+";
  if (c.coupon) return "kód";
  if (c.priceType === 2) return "výkup";
  if (c.priceType === 1) return "cashback";
  return c.name || "akce";
}

interface BenefitsResult {
  entries: BenefitEntry[];
  complete: boolean;
  later?: Promise<BenefitsResult>;
}

const TIER_SOFT_MS = Number(process.env.TIER_SOFT_MS ?? 1200);
const LEAN_TIERS = process.env.TIERS_LEAN !== "0";
const CLUB_FOLLOWERS = ["Silver", "Bronze"];
const FIRST_TIERS = LEAN_TIERS ? TIERS.filter((t) => !CLUB_FOLLOWERS.includes(t.name)) : TIERS;

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

async function fetchBenefits(id: string): Promise<BenefitsResult> {
  const byTier = new Map<string, TierResult>();
  const load = (t: TierDef): Promise<void> =>
    fetchTier(id, t)
      .then((r) => {
        if (r) byTier.set(r.tier, r);
      })
      .catch(() => {});
  const done = (m: Map<string, TierResult>): BenefitsResult => ({
    ...buildBenefits(m),
    complete: FIRST_TIERS.every((t) => m.has(t.name)) && followerTiers(m).every((n) => m.has(n)),
  });
  const all = (async () => {
    await Promise.all(FIRST_TIERS.map(load));
    await Promise.all(TIERS.filter((t) => followerTiers(byTier).includes(t.name)).map(load));
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

export function buildBenefits(byTier: Map<string, TierResult>): BenefitsResult {

  const basic = byTier.get("Basic");
  const base = basic?.main?.amount ?? null;
  const entries: BenefitEntry[] = [];
  const percent = (amount: number): number | null =>
    base && base > amount ? ((base - amount) / base) * 100 : null;
  const shown = (amount: number, denominator: number | null = base): number | null => {
    const exact = denominator && denominator > amount ? ((denominator - amount) / denominator) * 100 : null;
    return exact === null ? null : Math.floor(exact + 50 / denominator! + 1e-9);
  };

  if (basic?.compare && base && basic.compare > base + 0.004) {
    entries.push({
      kind: "sale",
      label: "Sleva",
      price: base,
      priceText: fmtCzk2(base),
      percent: ((basic.compare - base) / basic.compare) * 100,
      percentShown: shown(base, basic.compare),
      wasPriceText: fmtCzk2(basic.compare),
    });
  }

  for (const pr of basic?.promos ?? []) {
    if (!(base && pr.amount < base - 0.004)) continue;
    let kind: BenefitEntry["kind"];
    let label: string;
    if (pr.priceType === 4) {
      kind = "alzaplus";
      label = "S AlzaPlus+";
    } else if (pr.coupon) {
      kind = "coupon";
      label = `S kódem ${pr.coupon}`;
    } else if (pr.priceType === 2) {
      kind = "tradein";
      label = pr.name || "S výkupním bonusem";
    } else if (pr.priceType === 1) {
      kind = "cashback";
      label = pr.name || "S Cashback";
    } else {
      kind = "promo";
      label = pr.name || "Akční cena";
    }
    const fromCode = kind === "coupon" ? Number(/(d{1,2})$/.exec(pr.coupon ?? "")?.[1]) : NaN;
    const calculated = shown(pr.amount);
    const percentShown = Number.isFinite(fromCode) && calculated !== null && Math.abs(fromCode - calculated) <= 1 ? fromCode : calculated;
    entries.push({ kind, label, price: pr.amount, priceText: fmtCzk2(pr.amount), percent: percent(pr.amount), percentShown });
  }

  interface ClubRow {
    names: string[];
    listPrice: number;
    best: number;
    promo: PriceCandidate | null;
  }
  const rows: ClubRow[] = [];
  for (const name of ["Gold", "Silver", "ISIC", "Bronze", "B2B"]) {
    const t = byTier.get(name);
    if (!t || t.hidden || !t.main || !t.selected) continue;
    if (!(base && t.main.amount < base - 0.004)) continue;
    const lowered = t.selected.amount < t.main.amount - 0.004;
    rows.push({
      names: [name],
      listPrice: t.main.amount,
      best: t.selected.amount,
      promo: lowered ? t.selected : null,
    });
  }

  for (const [source, into] of [["ISIC", "Silver"], ["B2B", "Bronze"]] as const) {
    const s = rows.find((r) => r.names.includes(source));
    const d = rows.find((r) => r.names.includes(into));
    if (s && d && s !== d && Math.abs(s.listPrice - d.listPrice) < 0.005 && Math.abs(s.best - d.best) < 0.005) {
      d.names = d.names.concat(s.names.filter((n) => !d.names.includes(n)));
      rows.splice(rows.indexOf(s), 1);
    }
  }

  for (const r of rows) {
    entries.push({
      kind: "tier",
      label: r.names.join("/"),
      price: r.best,
      priceText: fmtCzk2(r.best),
      percent: percent(r.best),
      percentShown: base && base > r.best ? Math.round(((base - r.best) / base) * 100) : null,
      ...(r.promo ? { wasPriceText: fmtCzk2(r.listPrice), note: promoTag(r.promo) } : {}),
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
  return { entries: entries.slice(0, 8), complete: byTier.size === TIERS.length };
}

// JSON-LD itemCondition says whether it is second hand, the grade is only in the stock label.
export function conditionText(itemCondition: unknown, html: string): string | null {
  const kind = String(itemCondition ?? "").split("/").pop();
  if (kind === "RefurbishedCondition") return "Repasované";
  if (kind === "DamagedCondition") return "Poškozené";
  if (kind !== "UsedCondition") return null;
  const grade = /class="stcStock[^"]*"[^>]*title="\s*(Rozbaleno|Zánovní|Použité)/.exec(html)?.[1];
  return grade ?? "Použité";
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

async function getHtml(path: string): Promise<string> {
  const res = await fetchUrl(`https://www.alza.cz${path}`, {
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "cs-CZ,cs;q=0.9,en;q=0.8",
    },
    timeoutMs: 25000,
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

function fmtCzk(n: number): string {
  return new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 0 }).format(n).replace(/\u00A0/g, " ");
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
): Promise<ProductData> {
  const html = await getHtml(path);
  const p = extractProductJsonLd(html);
  if (!p) throw new Error("no Product JSON-LD found on the page");

  const benefitsPromise: Promise<BenefitsResult> = BENEFITS_ENABLED
    ? fetchBenefits(id).catch((e) => {
        console.error(`[benefits] ${id}: ${e instanceof Error ? e.message : e}`);
        return { entries: [], complete: false };
      })
    : Promise.resolve({ entries: [], complete: true });

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

  const availability = offers?.availability ? String(offers.availability).split("/").pop()! : "unknown";

  const claimed = offers?.url ? String(offers.url) : typeof p["@id"] === "string" ? String(p["@id"]).replace(/#.*$/, "") : null;
  const canonicalUrl = (claimed && httpsUrlOn(claimed, "alza.cz")) || `https://www.alza.cz${path}`;
  if (image && !httpsUrlOn(image, "alza.cz")) image = null;

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
        onLateBenefits?.(b.entries, b.complete);
      }
      void b.later?.then((l) => onLateBenefits?.(l.entries, l.complete));
    });
  }

  return {
    id,
    name: decodeEntities(String(p.name ?? slugTitle(path))),
    price,
    priceText: price === null ? null : `${fmtCzk(price)} Kč`,
    availability,
    availabilityText: AVAILABILITY_CS[availability] ?? "Neznámá dostupnost",
    ...(conditionText(offers?.itemCondition, html) ? { condition: conditionText(offers?.itemCondition, html)! } : {}),
    rating,
    ratingCount,
    brand: p.brand?.name ? String(p.brand.name) : null,
    ...(cleanDescription(p.description) ? { description: cleanDescription(p.description)! } : {}),
    image,
    canonicalUrl,
    benefits,
    ...(partial ? { partial: true as const } : {}),
    fetchedAt: new Date().toISOString(),
  };
}
