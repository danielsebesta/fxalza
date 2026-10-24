// Helpers for text and addresses that came from somewhere else: an upstream page, a JSON-LD block, a link somebody typed.

const HTML_ENTITIES: Record<string, string> = { quot: '"', amp: "&", lt: "<", gt: ">", apos: "'", nbsp: " " };

// A numeric entity beyond the Unicode range (&#99999999999;) would make String.fromCodePoint throw; such an entity is left as written.
function codePoint(n: number): string | null {
  return Number.isInteger(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : null;
}

export function decodeEntities(t: string): string {
  return t.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (m, dec?: string, hex?: string, name?: string) =>
    dec ? (codePoint(Number(dec)) ?? m) : hex ? (codePoint(parseInt(hex, 16)) ?? m) : (HTML_ENTITIES[name!.toLowerCase()] ?? m),
  );
}

// An https address on `domain` or one of its subdomains, as an absolute string, or null. A user name or password in front of
// the host ("https://evil.com@www.alza.cz/") is refused: the host check would pass and a browser would show the deceptive part.
// A relative value is resolved against `base` when one is given.
export function httpsUrlOn(value: string, domain: string, base?: string): string | null {
  let u: URL;
  try {
    u = new URL(value, base);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password) return null;
  const host = u.hostname.toLowerCase();
  const wanted = domain.toLowerCase();
  return host === wanted || host.endsWith(`.${wanted}`) ? u.toString() : null;
}
