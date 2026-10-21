import { createHmac, randomBytes } from "node:crypto";
import type http from "node:http";
import { BlockList, isIP } from "node:net";

const DISCORD_PER_MIN = Number(process.env.RATE_DISCORD_PER_MIN ?? 30);
const OTHER_PER_10MIN = Number(process.env.RATE_OTHER_PER_10MIN ?? 3);
const GLOBAL_PER_MIN = Number(process.env.RATE_GLOBAL_PER_MIN ?? 45);
const OTHER_GLOBAL_PER_MIN = Number(process.env.RATE_OTHER_GLOBAL_PER_MIN ?? 6);
const CRAWLER_PER_MIN = Number(process.env.RATE_CRAWLER_PER_MIN ?? 6);
const CRAWLER_GLOBAL_PER_MIN = Number(process.env.RATE_CRAWLER_GLOBAL_PER_MIN ?? 10);
const STORE_MAX = 10_000;
const DISCORD_UA = /Discordbot/i;
const TELEGRAM_UA = /TelegramBot/i;
// Link-preview crawlers with no published address ranges (or none we check), so the user agent is the only signal.
const CRAWLER_UA = /Slackbot|facebookexternalhit|meta-externalagent|Facebot|WhatsApp|Twitterbot|LinkedInBot/i;
const DISCORD_RANGES_URL = process.env.DISCORD_IPRANGES_URL ?? "https://cdn.discordapp.com/ipranges/discord.json";
const TELEGRAM_RANGES_URL = process.env.TELEGRAM_CIDR_URL ?? "https://core.telegram.org/resources/cidr.txt";
const DISCORD_IPS_STRICT = process.env.DISCORD_IPS_STRICT !== "0";

// Fallback until the first successful download, and when Telegram's list is unreachable.
const TELEGRAM_CIDRS = [
  "91.108.4.0/22", "91.108.8.0/22", "91.108.12.0/22", "91.108.16.0/22", "91.108.20.0/22", "91.108.56.0/22",
  "91.105.192.0/23", "149.154.160.0/20", "185.76.151.0/24",
  "2001:b28:f23c::/48", "2001:b28:f23d::/48", "2001:b28:f23f::/48", "2001:67c:4e8::/48", "2a0a:f280::/32",
];

function buildRanges(cidrs: string[]): { list: BlockList; count: number } {
  const list = new BlockList();
  let count = 0;
  for (const cidr of cidrs) {
    const [address, bits] = cidr.trim().split("/");
    if (!address || !bits || !isIP(address)) continue;
    list.addSubnet(address, Number(bits), isIP(address) === 4 ? "ipv4" : "ipv6");
    count++;
  }
  return { list, count };
}

let telegramRanges: BlockList = buildRanges(TELEGRAM_CIDRS).list;

async function loadTelegramRanges(): Promise<void> {
  try {
    const res = await fetch(TELEGRAM_RANGES_URL, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const { list, count } = buildRanges((await res.text()).split("\n"));
    if (count === 0) throw new Error("no prefixes");
    telegramRanges = list;
    console.log(`[telegram] loaded ${count} address ranges`);
  } catch (e) {
    console.warn(`[telegram] address ranges not refreshed, keeping previous: ${e instanceof Error ? e.message : e}`);
  }
}

let discordRanges: BlockList | null = null;

async function loadDiscordRanges(): Promise<void> {
  try {
    const res = await fetch(DISCORD_RANGES_URL, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = (await res.json()) as { prefixes?: { ipv4Prefix?: string; ipv6Prefix?: string }[] };
    const list = new BlockList();
    let count = 0;
    for (const p of data.prefixes ?? []) {
      const cidr = p.ipv4Prefix ?? p.ipv6Prefix;
      if (!cidr) continue;
      const [address, bits] = cidr.split("/");
      if (!address || !bits || !isIP(address)) continue;
      list.addSubnet(address, Number(bits), p.ipv4Prefix ? "ipv4" : "ipv6");
      count++;
    }
    if (count === 0) throw new Error("no prefixes");
    discordRanges = list;
    console.log(`[discord] loaded ${count} address ranges`);
  } catch (e) {
    console.warn(`[discord] address ranges not loaded: ${e instanceof Error ? e.message : e}`);
  }
}

void loadDiscordRanges();
setInterval(() => void loadDiscordRanges(), 6 * 3600_000).unref();
void loadTelegramRanges();
setInterval(() => void loadTelegramRanges(), 6 * 3600_000).unref();

function listedAsDiscord(ip: string): boolean {
  return discordRanges !== null && isIP(ip) > 0 && discordRanges.check(ip, isIP(ip) === 4 ? "ipv4" : "ipv6");
}

function listedAsTelegram(ip: string): boolean {
  return isIP(ip) > 0 && telegramRanges.check(ip, isIP(ip) === 4 ? "ipv4" : "ipv6");
}

const SECRET = randomBytes(32);
const hits = new Map<string, number[]>();
let globalHits: number[] = [];
let otherGlobalHits: number[] = [];
let crawlerGlobalHits: number[] = [];

setInterval(() => {
  const cutoff = Date.now() - 10 * 60_000;
  for (const [key, list] of hits) {
    if ((list[list.length - 1] ?? 0) < cutoff) hits.delete(key);
  }
}, 60_000).unref();

function normalize(address: string | undefined): string {
  const ip = (address ?? "").replace(/^\[|\]$/g, "");
  return ip.startsWith("::ffff:") && isIP(ip.slice(7)) === 4 ? ip.slice(7) : ip.toLowerCase();
}

function isPrivate(ip: string): boolean {
  return (
    ip === "::1" ||
    /^(fc|fd|fe80)/.test(ip) ||
    /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip)
  );
}

function rawClientIp(req: http.IncomingMessage): string {
  const peer = normalize(req.socket.remoteAddress);
  if (!isPrivate(peer)) return peer;
  const cf = req.headers["cf-connecting-ip"];
  if (typeof cf === "string" && isIP(cf.trim())) return normalize(cf.trim());
  const forwarded = String(req.headers["x-forwarded-for"] ?? "").split(",")[0]!.trim();
  return isIP(forwarded) ? normalize(forwarded) : peer;
}

export interface Requester {
  id: string;
  discord: boolean;
  telegram: boolean;
  telegramListed: boolean;
  crawler: boolean;
  unlisted: boolean;
}

export function identify(req: http.IncomingMessage, userAgent: string): Requester {
  const ip = rawClientIp(req);
  const id = createHmac("sha256", SECRET).update(ip).digest("hex").slice(0, 16);
  const listed = listedAsDiscord(ip);
  const claimsDiscord = DISCORD_UA.test(userAgent);
  const telegram = TELEGRAM_UA.test(userAgent);
  const telegramListed = telegram && listedAsTelegram(ip);
  const unlisted = claimsDiscord && !listed && discordRanges !== null;
  return { id, discord: listed || (claimsDiscord && !(DISCORD_IPS_STRICT && discordRanges !== null)), telegram, telegramListed, crawler: CRAWLER_UA.test(userAgent), unlisted };
}

export type RateTier = "discord" | "crawler" | "other";

export function rateTier(who: Requester): RateTier {
  if (who.discord || who.telegramListed) return "discord";
  return who.crawler ? "crawler" : "other";
}

export function allowFetch(id: string, tier: RateTier): boolean {
  const now = Date.now();
  globalHits = globalHits.filter((t) => now - t < 60_000);
  if (globalHits.length >= GLOBAL_PER_MIN) return false;
  otherGlobalHits = otherGlobalHits.filter((t) => now - t < 60_000);
  if (tier === "other" && otherGlobalHits.length >= OTHER_GLOBAL_PER_MIN) return false;
  crawlerGlobalHits = crawlerGlobalHits.filter((t) => now - t < 60_000);
  if (tier === "crawler" && crawlerGlobalHits.length >= CRAWLER_GLOBAL_PER_MIN) return false;

  const windowMs = tier === "other" ? 10 * 60_000 : 60_000;
  const max = tier === "discord" ? DISCORD_PER_MIN : tier === "crawler" ? CRAWLER_PER_MIN : OTHER_PER_10MIN;
  const key = `${tier[0]}:${id}`;
  const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (list.length >= max) {
    hits.set(key, list);
    return false;
  }

  list.push(now);
  hits.set(key, list);
  globalHits.push(now);
  if (tier === "other") otherGlobalHits.push(now);
  if (tier === "crawler") crawlerGlobalHits.push(now);
  if (hits.size > STORE_MAX) hits.delete(hits.keys().next().value!);
  return true;
}
