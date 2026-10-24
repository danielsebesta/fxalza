import assert from "node:assert/strict";
import { test } from "node:test";
import { readBodyCapped } from "../src/fetcher.ts";
import { parseKodList } from "../src/kodlist.ts";
import { clientKey } from "../src/ratelimit.ts";
import { decodeEntities, httpsUrlOn } from "../src/sanitize.ts";
import { parseSiteDomains } from "../src/shops.ts";

test("a numeric entity outside Unicode is left as written instead of throwing", () => {
  assert.equal(decodeEntities("A &amp; B &#233; &#x1F600; &#99999999999; &#xFFFFFFFF; &bogus;"), "A & B é 😀 &#99999999999; &#xFFFFFFFF; &bogus;");
});

test("httpsUrlOn takes Alza's own https addresses and nothing that only looks like one", () => {
  assert.equal(httpsUrlOn("https://www.alza.cz/x-d1.htm", "alza.cz"), "https://www.alza.cz/x-d1.htm");
  assert.equal(httpsUrlOn("https://image.alza.cz/i.jpg", "alza.cz"), "https://image.alza.cz/i.jpg");
  assert.equal(httpsUrlOn("/x-d1.htm", "alza.cz", "https://www.alza.cz/"), "https://www.alza.cz/x-d1.htm");
  assert.equal(httpsUrlOn("http://www.alza.cz/x-d1.htm", "alza.cz"), null);
  assert.equal(httpsUrlOn("https://evil.com@www.alza.cz/x-d1.htm", "alza.cz"), null);
  assert.equal(httpsUrlOn("https://www.alza.cz.evil.com/x-d1.htm", "alza.cz"), null);
  assert.equal(httpsUrlOn("https://notalza.cz/x-d1.htm", "alza.cz"), null);
  assert.equal(httpsUrlOn("javascript:alert(1)", "alza.cz"), null);
  assert.equal(httpsUrlOn("not a url", "alza.cz"), null);
});

test("a listing row that links through a user name is skipped", () => {
  const row = (href: string) => `<div class="box-row"><a class="name js-box-link" href="${href}">Thing</a></div>`;
  assert.equal(parseKodList(row("https://u:p@www.alza.cz/thing-d1.htm"), 1), null);
  assert.equal(parseKodList(row("/thing-d1.htm"), 1)?.items[0]?.url, "https://www.alza.cz/thing-d1.htm");
});

test("SHOP_DOMAINS only takes real shop codes", () => {
  assert.deepEqual(parseSiteDomains("__proto__=evil.com,constructor=evil.com,sk=fxalza.sk"), { sk: "fxalza.sk" });
});

test("IPv6 clients are limited per /64, IPv4 per address", () => {
  assert.equal(clientKey("2001:db8:1:2:aaaa::1"), clientKey("2001:db8:1:2:bbbb:cccc:dddd:eeee"));
  assert.notEqual(clientKey("2001:db8:1:2::1"), clientKey("2001:db8:1:3::1"));
  assert.equal(clientKey("203.0.113.7"), "203.0.113.7");
  assert.notEqual(clientKey("203.0.113.7"), clientKey("203.0.113.8"));
});

test("readBodyCapped stops at the limit, by the declared length or while reading", async () => {
  assert.equal(await readBodyCapped(new Response("short"), 100), "short");
  await assert.rejects(readBodyCapped(new Response("x".repeat(200)), 100), /over the 100 byte limit/);
  const declared = new Response("abc", { headers: { "content-length": "5000" } });
  await assert.rejects(readBodyCapped(declared, 100), /over the 100 byte limit/);
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(c) {
      c.enqueue(encoder.encode("x".repeat(60)));
      c.enqueue(encoder.encode("y".repeat(60)));
      c.close();
    },
  });
  await assert.rejects(readBodyCapped(new Response(stream), 100), /over the 100 byte limit/);
});

test("TRUSTED_PROXIES narrows who may name the visitor, and is off by default", async () => {
  const { buildTrustedProxies } = await import("../src/ratelimit.ts");
  assert.equal(buildTrustedProxies(undefined), null);
  assert.equal(buildTrustedProxies("  "), null);
  const trusted = buildTrustedProxies("127.0.0.1, ::1, 10.1.0.0/16")!;
  assert.equal(trusted("127.0.0.1"), true);
  assert.equal(trusted("::1"), true);
  assert.equal(trusted("10.1.4.4"), true);
  assert.equal(trusted("10.2.0.1"), false);
  assert.equal(trusted("192.168.1.5"), false);
  assert.equal(trusted("garbage"), false);
});
