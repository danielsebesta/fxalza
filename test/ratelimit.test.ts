import assert from "node:assert/strict";
import { test } from "node:test";
import { allowFetch, anonymizeIp, identify, rateTier, retryAfterSeconds } from "../src/ratelimit.ts";

function request(userAgent: string, ip = "127.0.0.1") {
  return {
    socket: { remoteAddress: ip },
    headers: { "user-agent": userAgent },
  } as never;
}

test("identifies Telegram crawlers separately from Discord", () => {
  const telegram = identify(request("TelegramBot"), "TelegramBot");
  assert.equal(telegram.telegram, true);
  assert.equal(telegram.discord, false);

  const discord = identify(request("Discordbot/2.0"), "Discordbot/2.0");
  assert.equal(discord.telegram, false);
});

test("Telegram gets the higher rate limit only from Telegram's address ranges", () => {
  assert.equal(identify(request("TelegramBot (like TwitterBot)", "149.154.161.5"), "TelegramBot (like TwitterBot)").telegramListed, true);
  const spoofed = identify(request("TelegramBot", "203.0.113.7"), "TelegramBot");
  assert.equal(spoofed.telegram, true);
  assert.equal(spoofed.telegramListed, false);
});

test("known link-preview crawlers get the crawler tier, unknown clients stay in other", () => {
  assert.equal(rateTier(identify(request("Slackbot-LinkExpanding 1.0", "203.0.113.7"), "Slackbot-LinkExpanding 1.0")), "crawler");
  assert.equal(rateTier(identify(request("curl/8", "203.0.113.7"), "curl/8")), "other");
  assert.equal(rateTier(identify(request("TelegramBot", "149.154.161.5"), "TelegramBot")), "discord");
});

test("crawler tier is capped globally", () => {
  const results = Array.from({ length: 12 }, (_, i) => allowFetch(`crawler-${i}`, "crawler"));
  assert.equal(results.filter(Boolean).length, 10);
});

test("a refused client is told to wait for its own window, ten minutes for the other tier", () => {
  // RATE_OTHER_PER_10MIN defaults to 3 per client; the fourth attempt is refused
  const results = Array.from({ length: 4 }, () => allowFetch("other-client", "other"));
  assert.deepEqual(results, [true, true, true, false]);
  const wait = retryAfterSeconds("other-client", "other");
  assert.ok(wait > 500 && wait <= 600, `expected close to ten minutes, got ${wait}s`);
  // a client that was never refused is not told to wait
  assert.equal(retryAfterSeconds("fresh-client", "discord"), 1);
});

test("anonymizeIp zeroes the host part of both address families", () => {
  assert.equal(anonymizeIp("200.160.12.34"), "200.160.12.0");
  assert.equal(anonymizeIp("2001:db8:85a3:8d3:1319:8a2e:370:7348"), "2001:db8:85a3::");
  assert.equal(anonymizeIp("2001:db8::1"), "2001:db8:0::");
  assert.equal(anonymizeIp("::1"), "0:0:0::");
  assert.equal(anonymizeIp("not an ip"), undefined);
});
