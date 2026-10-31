// What Hlídač shopů knows about the price of a product, from the API its own browser extension reads. It is an extra in the embed:
// it holds nothing up for long, and when it fails the line is simply left out. Only Alza.cz and Alza.sk are followed there (Shop.history).
import { readBodyCapped } from "./fetcher.ts";
import { texts } from "./i18n.ts";
import { formatMoney, type Shop } from "./shops.ts";

const ENABLED = process.env.HISTORY !== "0";
const TIMEOUT_MS = Number(process.env.HISTORY_TIMEOUT_MS ?? 1500);
const API = "https://api.hlidacshopu.cz/v2/detail";
const USER_AGENT = "fxalza/1.0 (+https://github.com/danielsebesta/fxalza)";
// a year of daily prices is about 30 kB
const MAX_BODY_BYTES = 256 * 1024;
// A shorter series says nothing about how low a price goes.
const MIN_DAYS = 30;
// The series covers 365 days and a product that was out of stock misses a few of them; that still is a year.
const YEAR_DAYS = 330;

export interface PriceHistory {
  // What Hlídač shopů measures a discount against: the usual price, or after a recent price drop the lowest one of the 30 days before it.
  reference: number | null;
  referenceKind: "usual" | "beforeSale";
  lowest: { price: number; date: string } | null;
  days: number;
}

const positive = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);

// Only a summary is kept: the whole series would be most of a cache entry and the embed shows none of it.
export function parseHistory(raw: unknown): PriceHistory | null {
  const { metadata, data } = (raw ?? {}) as { metadata?: Record<string, unknown>; data?: { currentPrice?: unknown } };
  const rows: { x?: unknown; y?: unknown }[] = Array.isArray(data?.currentPrice) ? data.currentPrice : [];
  const priced = rows.flatMap((row) => {
    const price = positive(row?.y);
    const date = typeof row?.x === "string" ? /^\d{4}-\d\d-\d\d/.exec(row.x)?.[0] : undefined;
    return price !== null && date ? [{ price, date }] : [];
  });
  const referenceKind = metadata?.type === "eu-minimum" ? "beforeSale" : "usual";
  const reference = positive(referenceKind === "beforeSale" ? metadata?.minPrice : metadata?.commonPrice);
  // the series runs from the oldest day, so a price reached several times is dated by the last of them
  const lowest = priced.length >= MIN_DAYS ? priced.reduce((best, row) => (row.price <= best.price ? row : best)) : null;
  if (reference === null && lowest === null) return null;
  return { reference, referenceKind, lowest, days: priced.length };
}

export async function fetchPriceHistory(shop: Shop, id: string): Promise<PriceHistory | null> {
  if (!ENABLED || !shop.history) return null;
  const product = `https://${shop.host}/-d${id}.htm`;
  try {
    const res = await fetch(`${API}?url=${encodeURIComponent(product)}`, {
      headers: { accept: "application/json", "user-agent": USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      // a product it does not follow
      if (res.status === 404) return null;
      throw new Error(`HTTP ${res.status}`);
    }
    return parseHistory(JSON.parse(await readBodyCapped(res, MAX_BODY_BYTES)));
  } catch (e) {
    console.warn(`[history] ${shop.code}:${id} not loaded: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

function dateText(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${Number(day)}. ${Number(month)}. ${year}`;
}

// The change is worked out from `price`, the one the embed shows, and not taken from the API: Hlídač shopů does not see the
// Black Friday box of a page, so for it a product at 349 Kč in that box still costs 1 148 Kč and the sale does not exist.
export function historyLine(h: PriceHistory, shop: Shop, price: number | null, rich = false): string | null {
  const t = texts(shop.lang).history;
  if (!t) return null;
  const money = (n: number): string => (rich ? `**${formatMoney(shop, n)}**` : formatMoney(shop, n));
  const { reference, lowest } = h;
  const span = h.days >= YEAR_DAYS ? t.year : t.days(h.days);
  const change = reference !== null && price !== null ? Math.round(((price - reference) / reference) * 100) : 0;
  // a price that never moved is the lowest as well, and there is nothing to say about that
  const atLowest = lowest !== null && reference !== null && price !== null && price <= lowest.price && price < reference;
  const notes = [...(change !== 0 ? [`${t.now} ${change < 0 ? "−" : "+"}${Math.abs(change)} %`] : []), ...(atLowest ? [`${t.lowest} ${span}`] : [])];
  const parts: string[] = [];
  if (reference !== null) parts.push(`${h.referenceKind === "beforeSale" ? t.beforeSale : t.usual} ${money(reference)}${notes.length > 0 ? ` (${notes.join(", ")})` : ""}`);
  // the usual price comes from a longer window than the series, and can be below everything in it
  if (lowest !== null && !atLowest && (reference === null || lowest.price < reference)) parts.push(`${span} ${t.lowest} ${money(lowest.price)} (${dateText(lowest.date)})`);
  return parts.length > 0 ? `Hlídač shopů: ${parts.join(", ")}` : null;
}
