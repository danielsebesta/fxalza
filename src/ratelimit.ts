import { createHmac, randomBytes } from "node:crypto";
import type http from "node:http";
import { isIP } from "node:net";

const DISCORD_PER_MIN = Number(process.env.RATE_DISCORD_PER_MIN ?? 10);
const OTHER_PER_10MIN = Number(process.env.RATE_OTHER_PER_10MIN ?? 3);
const GLOBAL_PER_MIN = Number(process.env.RATE_GLOBAL_PER_MIN ?? 20);
const STORE_MAX = 10_000;
const DISCORD_UA = /Discordbot/i;

const SECRET = randomBytes(32);
const hits = new Map<string, number[]>();
let globalHits: number[] = [];

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

export function isDiscord(userAgent: string): boolean {
  return DISCORD_UA.test(userAgent);
}

function rawClientIp(req: http.IncomingMessage): string {
  const peer = normalize(req.socket.remoteAddress);
  if (!isPrivate(peer)) return peer;
  const cf = req.headers["cf-connecting-ip"];
  if (typeof cf === "string" && isIP(cf.trim())) return normalize(cf.trim());
  const forwarded = String(req.headers["x-forwarded-for"] ?? "").split(",")[0]!.trim();
  return isIP(forwarded) ? normalize(forwarded) : peer;
}

export function clientId(req: http.IncomingMessage): string {
  return createHmac("sha256", SECRET).update(rawClientIp(req)).digest("hex").slice(0, 16);
}

export function allowFetch(id: string, discord: boolean): boolean {
  const now = Date.now();
  globalHits = globalHits.filter((t) => now - t < 60_000);
  if (globalHits.length >= GLOBAL_PER_MIN) return false;

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
  if (hits.size > STORE_MAX) hits.delete(hits.keys().next().value!);
  return true;
}
