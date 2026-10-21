import assert from "node:assert/strict";
import { test } from "node:test";
import { identify } from "../src/ratelimit.ts";

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
