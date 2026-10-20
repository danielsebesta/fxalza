import { createHmac, randomBytes } from "node:crypto";
import type http from "node:http";
import { BlockList, isIP } from "node:net";

const DISCORD_PER_MIN = Number(process.env.RATE_DISCORD_PER_MIN ?? 30);
const OTHER_PER_10MIN = Number(process.env.RATE_OTHER_PER_10MIN ?? 3);
const GLOBAL_PER_MIN = Number(process.env.RATE_GLOBAL_PER_MIN ?? 45);
const OTHER_GLOBAL_PER_MIN = Number(process.env.RATE_OTHER_GLOBAL_PER_MIN ?? 6);
const STORE_MAX = 10_000;
const DISCORD_UA = /Discordbot/i;
const TELEGRAM_UA = /TelegramBot/i;
const DISCORD_RANGES_URL = process.env.DISCORD_IPRANGES_URL ?? "https://cdn.discordapp.com/ipranges/discord.json";
const DISCORD_IPS_STRICT = process.env.DISCORD_IPS_STRICT !== "0";

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

function listedAsDiscord(ip: string): boolean {
  return discordRanges !== null && isIP(ip) > 0 && discordRanges.check(ip, isIP(ip) === 4 ? "ipv4" : "ipv6");
}

const SECRET = randomBytes(32);
const hits = new Map<string, number[]>();
let globalHits: number[] = [];
let otherGlobalHits: number[] = [];

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
  unlisted: boolean;
}

export function identify(req: http.IncomingMessage, userAgent: string): Requester {
  const ip = rawClientIp(req);
  const id = createHmac("sha256", SECRET).update(ip).digest("hex").slice(0, 16);
  const listed = listedAsDiscord(ip);
  const claimsDiscord = DISCORD_UA.test(userAgent);
  const telegram = TELEGRAM_UA.test(userAgent);
  const unlisted = claimsDiscord && !listed && discordRanges !== null;
  return { id, discord: listed || (claimsDiscord && !(DISCORD_IPS_STRICT && discordRanges !== null)), telegram, unlisted };
}

export function allowFetch(id: string, discord: boolean): boolean {
  const now = Date.now();
  globalHits = globalHits.filter((t) => now - t < 60_000);
  if (globalHits.length >= GLOBAL_PER_MIN) return false;
  otherGlobalHits = otherGlobalHits.filter((t) => now - t < 60_000);
  if (!discord && otherGlobalHits.length >= OTHER_GLOBAL_PER_MIN) return false;

  const windowMs = discord ? 60_000 : 10 * 60_000;
  const max = discord ? DISCORD_PER_MIN : OTHER_PER_10MIN;
  const key = `${discord ? "d" : "o"}:${id}`;
  const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (list.length >= max) {
    hits.set(key, list);
    return false;
  }

  list.push(now);
  hits.set(key, list);
  globalHits.push(now);
  if (!discord) otherGlobalHits.push(now);
  if (hits.size > STORE_MAX) hits.delete(hits.keys().next().value!);
  return true;
}
