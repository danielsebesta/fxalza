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

function tidyText(t: string): string {
  return t
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
}

// Decode entities, then strip tags. Alza's JSON-LD often escapes markup (&lt;strong&gt;…), so decode runs
// before the strip; a second decode picks up entities that lived inside the tag content.
function withoutTags(raw: string): string {
  return decodeEntities(decodeEntities(raw).replace(/<[^>]*>/g, " "));
}

// Discord can show bold/italic, so <strong>/<b> and <em>/<i> become **…** / *…*; every other tag is dropped.
export function emphasisMd(raw: string): string {
  let t = decodeEntities(raw);
  t = t.replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, "**$2**");
  t = t.replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, "*$2*");
  return tidyText(decodeEntities(t.replace(/<[^>]*>/g, " ")));
}

// Plain text for Open Graph and the page body: no tags, no leftover markdown markers.
export function plainText(raw: string): string {
  return tidyText(withoutTags(raw).replace(/\*+/g, ""));
}

// Private-use stand-ins so markdown escaping does not touch emphasis we intentionally keep for Discord.
const BOLD = "\uE000";
const ITALIC = "\uE001";

// Description ready for a Discord markdown message: emphasis kept as * / **, other markdown escaped.
export function discordMd(raw: string): string {
  let t = decodeEntities(raw);
  t = t.replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, inner: string) => `${BOLD}${inner}${BOLD}`);
  t = t.replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, inner: string) => `${ITALIC}${inner}${ITALIC}`);
  // cleanDescription may already have stored **…** / *…*
  t = t.replace(/\*\*([^*]+)\*\*/g, (_, inner: string) => `${BOLD}${inner}${BOLD}`);
  t = t.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, (_, inner: string) => `${ITALIC}${inner}${ITALIC}`);
  t = tidyText(decodeEntities(t.replace(/<[^>]*>/g, " ")));
  t = t.replace(/([\\*_[\]~`|])/g, "\\$1");
  return t.replaceAll(BOLD, "**").replaceAll(ITALIC, "*");
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
