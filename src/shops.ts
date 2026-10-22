// The Alza shops we can read. They share one price API (webapi.alza.cz, the country is a parameter) and the same price list ids.
export type ShopCode = "cz" | "sk" | "hu" | "de" | "at";
export type Lang = "cs" | "sk" | "hu" | "de";

export interface Shop {
  code: ShopCode;
  tld: string;
  host: string;
  // value of the country parameter of the price API
  country: string;
  locale: string;
  // how the shop writes a price: Alza prints 2 299 € in Germany and Austria too, with a space and not a dot
  moneyLocale: string;
  lang: Lang;
  currency: "CZK" | "EUR" | "HUF";
  // Alza.hu and Alza.at have no ISIC price list
  hasIsic: boolean;
  // Hlídač shopů takes Czech and Slovak Alza links, not the Hungarian, German or Austrian ones
  history: boolean;
}

export const SHOPS: Record<ShopCode, Shop> = {
  cz: { code: "cz", tld: "cz", host: "www.alza.cz", country: "CZ", locale: "cs-CZ", moneyLocale: "cs-CZ", lang: "cs", currency: "CZK", hasIsic: true, history: true },
  sk: { code: "sk", tld: "sk", host: "www.alza.sk", country: "SK", locale: "sk-SK", moneyLocale: "sk-SK", lang: "sk", currency: "EUR", hasIsic: true, history: true },
  hu: { code: "hu", tld: "hu", host: "www.alza.hu", country: "HU", locale: "hu-HU", moneyLocale: "hu-HU", lang: "hu", currency: "HUF", hasIsic: false, history: false },
  de: { code: "de", tld: "de", host: "www.alza.de", country: "DE", locale: "de-DE", moneyLocale: "sk-SK", lang: "de", currency: "EUR", hasIsic: true, history: false },
  at: { code: "at", tld: "at", host: "www.alza.at", country: "AT", locale: "de-AT", moneyLocale: "sk-SK", lang: "de", currency: "EUR", hasIsic: false, history: false },
};

export const CZ = SHOPS.cz;
export const ALL_SHOPS: Shop[] = Object.values(SHOPS);

export function shopByTld(tld: string): Shop | null {
  return ALL_SHOPS.find((s) => s.tld === tld.toLowerCase()) ?? null;
}

// Where the pages of a shop live. By default that is a subdomain of the apex (sk.fxalza.cz) and Czech is the apex itself.
// A shop can have a domain of its own (SHOP_DOMAINS="sk=fxalza.sk,hu=fxalza.hu"); everything that writes an address of this
// site asks siteHost(), so moving a shop onto its own domain is that one setting. The subdomain keeps working next to it.
export type SiteDomains = Partial<Record<ShopCode, string>>;

export function parseSiteDomains(raw: string | undefined): SiteDomains {
  const out: SiteDomains = {};
  for (const pair of (raw ?? "").split(",")) {
    const [code, domain] = pair.split("=").map((s) => s.trim().toLowerCase());
    if (code && domain && code in SHOPS && /^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) out[code as ShopCode] = domain;
  }
  return out;
}

export const SITE_APEX = new URL(process.env.PUBLIC_URL ?? "https://fxalza.cz").hostname.toLowerCase();
export const SITE_DOMAINS: SiteDomains = parseSiteDomains(process.env.SHOP_DOMAINS);

export function siteHost(shop: Shop, apex: string = SITE_APEX, domains: SiteDomains = SITE_DOMAINS): string {
  return domains[shop.code] ?? (shop.code === "cz" ? apex : `${shop.code}.${apex}`);
}

export function siteUrl(shop: Shop, apex: string = SITE_APEX, domains: SiteDomains = SITE_DOMAINS): string {
  return `https://${siteHost(shop, apex, domains)}`;
}

// The shop whose pages this host serves: its own domain or its subdomain of the apex ("sk.fxalza.cz"). The apex is the Czech shop,
// www and anything unknown are not a shop host.
export function shopOfHost(host: string, apex: string = SITE_APEX, domains: SiteDomains = SITE_DOMAINS): Shop | null {
  return (
    ALL_SHOPS.find((s) => host === siteHost(s, apex, domains)) ??
    ALL_SHOPS.find((s) => domains[s.code] !== undefined && host === `www.${domains[s.code]}`) ??
    ALL_SHOPS.find((s) => host === `${s.code}.${apex}`) ??
    null
  );
}

// Whole crowns and forints, euros with cents. `precise` keeps the haléře of a Czech price, as the price lists print them.
const formatters = new Map<string, Intl.NumberFormat>();

function formatter(locale: string, minimumFractionDigits: number, maximumFractionDigits: number): Intl.NumberFormat {
  const key = `${locale}/${minimumFractionDigits}/${maximumFractionDigits}`;
  let f = formatters.get(key);
  // "always" because Hungarian would not group a four digit number, and Alza.hu writes 2 690 Ft
  if (!f) formatters.set(key, (f = new Intl.NumberFormat(locale, { minimumFractionDigits, maximumFractionDigits, useGrouping: "always" })));
  return f;
}

export function formatMoney(shop: Shop, n: number, precise = false): string {
  const [min, max] = shop.currency === "EUR" ? [Number.isInteger(n) ? 0 : 2, 2] : [0, shop.currency === "CZK" && precise ? 2 : 0];
  const text = formatter(shop.moneyLocale, min, max).format(n).replace(/[  ]/g, " ");
  return `${text} ${shop.currency === "CZK" ? "Kč" : shop.currency === "EUR" ? "€" : "Ft"}`;
}
