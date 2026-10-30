// Alza's "Výpis zboží" page (alza.cz/kod/<code>;<code>;...) lists several products by their order codes.
import { httpsUrlOn, plainText } from "./sanitize.ts";

export interface KodItem {
  id: string;
  name: string;
  url: string;
  price: number | null;
  priceText: string | null;
  wasText: string | null;
  availability: string | null;
  image: string | null;
}

export interface KodList {
  items: KodItem[];
  requested: number;
  total: number;
}

function text(raw: string): string {
  return plainText(raw);
}

// The raw page links products relatively ("/amd-ryzen-5-9600x-d12482042.htm"), a browser's saved copy has them absolute.
function alzaUrl(value: string | undefined, hostSuffix: string): string | null {
  if (!value) return null;
  return httpsUrlOn(value.replace(/&amp;/g, "&"), hostSuffix, `https://www.${hostSuffix}/`);
}

// Alza and Intl both group the digits with a no-break space (U+00A0, written as an escape so that an editor cannot swap it for a plain one).
function czk(raw: string): { value: number; text: string } | null {
  const m = /(\d[\d\s]*)(?:,(\d{1,2}))?/.exec(raw.replace(/ /g, " "));
  if (!m) return null;
  const value = Number(`${m[1]!.replace(/\s/g, "")}${m[2] ? `.${m[2]}` : ""}`);
  if (!Number.isFinite(value) || value <= 0) return null;
  return { value, text: `${new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 2 }).format(value).replace(/ /g, " ")} Kč` };
}

// Order codes are letters and digits. Some also contain "_" or "-" (APW_AWAY_84_42). Several codes are joined with ";".
export function isKodPath(pathname: string): boolean {
  return /^\/kod\/[A-Za-z0-9_;-]{1,400}$/.test(pathname);
}

export function kodCodes(pathname: string): string[] {
  return (pathname.replace(/^\/kod\//i, "").split(";").map((c) => c.trim()).filter(Boolean));
}

export function parseKodList(html: string, requested: number): KodList | null {
  const items: KodItem[] = [];
  const images = new Map<string, string>();
  for (const m of html.matchAll(/<img[^>]*\bid="img(\d+)"[^>]*>/gi)) {
    const srcset = /srcset="([^"]*)"/i.exec(m[0])?.[1];
    const url = alzaUrl(srcset?.split(",")[0]?.trim().split(/\s+/)[0], "alza.cz");
    if (url) images.set(m[1]!, url.split("?")[0]!);
  }
  for (const row of html.split('<div class="box-row">').slice(1)) {
    const nameLink = /<a[^>]*class="[^"]*\bname\b[^"]*js-box-link[^"]*"[^>]*>([\s\S]*?)<\/a>/i.exec(row);
    const tag = nameLink ? /<a[^>]*class="[^"]*\bname\b[^"]*js-box-link[^"]*"[^>]*>/i.exec(row)![0] : "";
    const url = alzaUrl(/href="([^"]*)"/i.exec(tag)?.[1], "alza.cz");
    const id = url ? /-d(\d{1,12})\.htm/i.exec(new URL(url).pathname)?.[1] : undefined;
    const name = nameLink ? text(nameLink[1]!) : "";
    if (!url || !id || !name) continue;
    const priceRaw = /class="[^"]*primary-price__value[^"]*"[^>]*>([\s\S]*?)<\//i.exec(row)?.[1];
    const wasRaw = /class="[^"]*js-compare-price[^"]*"[^>]*>([\s\S]*?)<\//i.exec(row)?.[1];
    const price = priceRaw ? czk(text(priceRaw)) : null;
    const was = wasRaw ? czk(text(wasRaw)) : null;
    // The box adds a quantity ("Skladem > 5 ks") or a date ("Očekáváme 29. října 2026", "Na cestě > 5 ks" plus a date line). Keep the status word.
    const availability = /(Není skladem|Na cestě|Očekáváme|Skladem u dodavatele|Skladem|Vyprodáno)/i.exec(text(row))?.[1] ?? null;
    items.push({
      id,
      name,
      url: url.split("?")[0]!,
      price: price?.value ?? null,
      priceText: price?.text ?? null,
      wasText: was && price && was.value > price.value ? was.text : null,
      availability: availability ? availability.trim() : null,
      image: images.get(id) ?? null,
    });
  }
  if (items.length === 0) return null;
  return { items, requested, total: items.reduce((sum, i) => sum + (i.price ?? 0), 0) };
}
