import assert from "node:assert/strict";
import { test } from "node:test";
import { identify } from "../src/ratelimit.ts";

function request(userAgent: string) {
  return {
    socket: { remoteAddress: "127.0.0.1" },
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