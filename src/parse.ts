export interface Parsed {
  id: string;
  path: string;
}

// Anything after the canonical ".../slug-d123.htm" (or the bare id forms) means the user changed the link on purpose.
export function hasCacheBustSuffix(pathname: string): boolean {
  return !/(?:-d\d{1,12}(?:\.htm)?|\/d?\d{1,12})\/?$/i.test(pathname);
}

// Alza lets a visitor read any shop in other languages, which it writes by prefixing the path with a language code
// (alza.cz/EN/..., alza.cz/DE/...) in capitals. Nothing real of a shop starts with a capital pair, so such a segment is
// dropped, and with it the lowercase spelling of the two languages the shops do offer in their own links: a preview and
// the link back to Alza stay in the default language of the domain, whatever code the pasted link carried. A lowercase
// category path other than those two is left as it is.
const LANGUAGE_PREFIX = /^\/(?:[A-Z]{2}|en|de)(\/.*)?$/;

export function withoutLanguagePrefix(pathname: string): string {
  let rest = pathname;
  while (true) {
    const language = LANGUAGE_PREFIX.exec(rest);
    if (!language) return rest;
    rest = language[1] ?? "/";
  }
}

// Some Alza links carry the product id only in ?dq=<id> and have no -d<id> in the path (e.g. /gaming/grand-theft-auto-v-gta-5?dq=6496142).
export function parseProductPath(pathname: string, dq?: string | null): Parsed | null {
  const slug = pathname.match(/^(\/[A-Za-z0-9._~%/-]*?-d(\d{1,12}))(?:\.[A-Za-z0-9]+)?\/?$/i);
  if (slug) return { id: slug[2]!, path: `${slug[1]}.htm` };
  const bare = pathname.match(/^\/d?(\d{1,12})\/?$/i);
  if (bare) return { id: bare[1]!, path: `/-d${bare[1]}.htm` };
  const last = [...pathname.matchAll(/-d(\d{1,12})(?!\d)/gi)].pop();
  if (!last) return pathname.length > 1 && dq && /^\d{1,12}$/.test(dq) ? { id: dq, path: `/-d${dq}.htm` } : null;
  const head = pathname.slice(0, last.index + last[0].length);
  return { id: last[1]!, path: /^\/[A-Za-z0-9._~%/-]*$/.test(head) ? `${head}.htm` : `/-d${last[1]}.htm` };
}

// Subdomains that send people to the browser extension instead of serving a preview.
const EXTENSION_SUBDOMAINS = new Set(["rozsireni", "extension", "script", "ext", "prohlizec", "browser"]);

export function isExtensionHost(host: string, apex: string): boolean {
  return host.endsWith(`.${apex}`) && EXTENSION_SUBDOMAINS.has(host.slice(0, -apex.length - 1));
}
