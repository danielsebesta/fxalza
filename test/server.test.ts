import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { SHOPS, partnerOfHost, shopOfHost } from "../src/shops.ts";

const CODE = "idp=8435&banner_id=34308";
const DISCORD = "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)";
const BROWSER = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const GB = "gb.fxalza.cz";

const here = path.dirname(fileURLToPath(import.meta.url));
let dir = "";
let port = 0;
let server: ChildProcess | undefined;

const product = (id: string, host: string) => ({
  at: Date.now(),
  data: {
    id,
    name: "Věc",
    price: 1000,
    priceText: "1 000 Kč",
    availability: "in_stock",
    availabilityText: "Skladem",
    rating: null,
    ratingCount: null,
    brand: null,
    image: "https://image.alza.cz/products/x.jpg",
    canonicalUrl: `https://${host}/vec-d${id}.htm`,
    benefits: [],
    fetchedAt: new Date().toISOString(),
  },
});

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port: free } = probe.address() as net.AddressInfo;
      probe.close(() => resolve(free));
    });
  });

// The server listens as soon as it is imported, so it runs on its own: a cache written here, and in place of a worker a fetch that answers with a saved listing.
before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fxalza-server-"));
  port = await freePort();
  const cache = path.join(dir, "cache.json");
  fs.writeFileSync(cache, JSON.stringify({ "123": product("123", "www.alza.cz"), "sk:123": product("123", "www.alza.sk") }));
  const listing = path.join(here, "fixtures", "kod-list-raw.html");
  const stub = path.join(dir, "stub-fetch.mjs");
  fs.writeFileSync(
    stub,
    `import { readFileSync } from "node:fs";
globalThis.fetch = async () => new Response(readFileSync(${JSON.stringify(listing)}), { headers: { "x-upstream-status": "200" } });
`,
  );
  server = spawn(process.execPath, ["--import", pathToFileURL(stub).href, path.join(here, "..", "src", "server.ts")], {
    // only what is set here: no key of a paid provider and no analytics from the machine running the tests
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      HOST: "127.0.0.1",
      PORT: String(port),
      PUBLIC_URL: "https://fxalza.cz",
      CACHE_FILE: cache,
      LOG_DIR: "",
      WARMUP_IDS: "",
      IP_RANGES_REFRESH: "0",
      SIDECAR_DISABLED: "1",
      CF_WORKERS: "https://stub.invalid|token",
    },
    stdio: ["ignore", "pipe", "inherit"],
  });
  await new Promise<void>((resolve, reject) => {
    server!.once("exit", (code) => reject(new Error(`server exited with ${code}`)));
    server!.stdout!.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes("listening on")) resolve();
    });
  });
});

after(() => {
  server?.removeAllListeners("exit");
  server?.kill();
  fs.rmSync(dir, { recursive: true, force: true });
});

interface Answer {
  status: number;
  location: string;
  body: string;
}

function get(host: string, target: string, ua = BROWSER): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: "127.0.0.1", port, path: target, headers: { host, "user-agent": ua } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, location: String(res.headers.location ?? ""), body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
  });
}

// every address on Alza.cz a page mentions, the ones in its Discord component included
const alzaLinks = (html: string): string[] => [...html.replace(/&amp;/g, "&").matchAll(/https:\/\/www\.alza\.cz[^"\s)<\\]*/g)].map((m) => m[0]);

function component(html: string): { text: string; title: string; button: string; history: string | undefined } {
  const raw = /<script id="discord:component-embed" type="application\/json">(.*?)<\/script>/s.exec(html)![1]!;
  const parts = (JSON.parse(raw) as { component: { components: { type: number; components?: { type: number; content?: string; url?: string; label?: string }[] }[] } }).component.components;
  const text = parts[0]!.components![0]!.content!;
  const buttons = parts.find((c) => c.type === 1)!.components!;
  return { text, title: /\]\((https:[^)]*)\)/.exec(text)![1]!, button: buttons[0]!.url!, history: buttons.find((b) => b.label === "Hlídač shopů")?.url };
}

test("the partner is recognised by its subdomain, also with a www, and is not a shop of its own", () => {
  assert.equal(partnerOfHost(GB, "fxalza.cz")?.query, CODE);
  assert.equal(partnerOfHost(`www.${GB}`, "fxalza.cz")?.shop, SHOPS.cz.code);
  for (const host of ["fxalza.cz", "www.fxalza.cz", "sk.fxalza.cz", "a.gb.fxalza.cz", "xgb.fxalza.cz", "gb.fxalza.cz.evil.com", "gb.example.com"]) {
    assert.equal(partnerOfHost(host, "fxalza.cz"), null, host);
  }
  assert.equal(shopOfHost(GB, "fxalza.cz"), null);
});

test("a visitor is sent on to Alza with the code and without our utm", async () => {
  for (const host of [GB, `www.${GB}`]) {
    const known = await get(host, "/vec-d123.htm");
    assert.equal(known.status, 302);
    assert.equal(known.location, `https://www.alza.cz/vec-d123.htm?${CODE}`);
  }
  assert.equal((await get(GB, "/neco-d456.htm")).location, `https://www.alza.cz/neco-d456.htm?${CODE}`);
  assert.equal((await get(GB, "/www.alza.cz/EN/vec-d123.htm")).location, `https://www.alza.cz/vec-d123.htm?${CODE}`);
  assert.equal((await get(GB, "/kod/ABC123;DEF456")).location, `https://www.alza.cz/kod/ABC123;DEF456?${CODE}`);
});

test("an address without a product goes to the same page on Alza, and the bare subdomain to the partner's own link", async () => {
  assert.equal((await get(GB, "/")).location, `https://www.alza.cz/?${CODE}`);
  assert.equal((await get(GB, "/notebooky/18842920.htm")).location, `https://www.alza.cz/notebooky/18842920.htm?${CODE}`);
  // whatever the path says, the visitor stays on Alza
  assert.equal((await get(GB, "//evil.example/x")).location, `https://www.alza.cz/x?${CODE}`);
  assert.equal(new URL((await get(GB, "/@evil.example/x")).location).hostname, "www.alza.cz");
  assert.equal((await get(GB, "/.well-known/security.txt")).status, 404);
});

test("a link cannot swap the code for another one, and the rest of its query stays", async () => {
  const { location } = await get(GB, "/vec-d123.htm?IDP=999&idp=998&Banner_Id=1&x=1&format=html");
  assert.equal(location, `https://www.alza.cz/vec-d123.htm?${CODE}&x=1`);
  assert.equal((await get(GB, `/vec-d123.htm?idp=999&x=${"y".repeat(600)}`)).location, `https://www.alza.cz/vec-d123.htm?${CODE}`);
});

test("every link of a Discord preview carries the code, only the price history stays bare", async () => {
  const { status, body } = await get(GB, "/vec-d123.htm", DISCORD);
  assert.equal(status, 200);
  const links = alzaLinks(body);
  assert.ok(links.length >= 4, links.join());
  for (const link of links) assert.equal(link, `https://www.alza.cz/vec-d123.htm?${CODE}`);
  const c = component(body);
  assert.equal(c.title, `https://www.alza.cz/vec-d123.htm?${CODE}`);
  assert.equal(c.button, `https://www.alza.cz/vec-d123.htm?${CODE}`);
  assert.equal(c.history, `https://www.hlidacshopu.cz/app/?url=${encodeURIComponent("https://www.alza.cz/vec-d123.htm")}`);
  assert.ok(body.includes(`<meta property="og:url" content="https://www.alza.cz/vec-d123.htm?${CODE.replace("&", "&amp;")}">`));
});

test("the top of a preview says whose link it is, in the partner's shop only", async () => {
  const header = (html: string): string => component(html).text.split("\n")[0]!;
  const siteName = (html: string): string => /<meta property="og:site_name" content="([^"]*)">/.exec(html)![1]!;
  for (const target of ["/vec-d123.htm", "/kod/ABC123;DEF456"]) {
    const { body } = await get(GB, target, DISCORD);
    assert.equal(header(body), "-# Alza.cz (GeekBoy affiliate)", target);
    assert.equal(siteName(body), "Alza.cz (GeekBoy affiliate)", target);
  }
  const slovak = (await get(GB, "/alza.sk/vec-d123.htm", DISCORD)).body;
  assert.equal(header(slovak), "-# Alza.sk");
  assert.equal(siteName(slovak), "Alza.sk");
  const plain = (await get("fxalza.cz", "/vec-d123.htm", DISCORD)).body;
  assert.equal(header(plain), "-# Alza.cz");
  assert.equal(siteName(plain), "Alza.cz");
});

test("a button too long for Discord loses the carried query but not the code", async () => {
  const { body } = await get(GB, `/vec-d123.htm?x=${"y".repeat(480)}`, DISCORD);
  const c = component(body);
  assert.equal(c.button, `https://www.alza.cz/vec-d123.htm?${CODE}`);
  assert.ok(c.title.startsWith(`https://www.alza.cz/vec-d123.htm?${CODE}&x=y`));
});

test("every link of a listing preview carries the code", async () => {
  const { status, body } = await get(GB, "/kod/ABC123;DEF456", DISCORD);
  assert.equal(status, 200);
  const links = alzaLinks(body);
  assert.ok(links.length >= 4, links.join());
  for (const link of links) assert.ok(link.endsWith(`?${CODE}`), link);
  assert.ok(links.some((l) => /-d\d+\.htm\?/.test(l)));
  assert.equal(component(body).button, `https://www.alza.cz/kod/ABC123;DEF456?${CODE}`);
});

test("the json answer names the address with the code, and the cached product stays clean for everybody else", async () => {
  const partnerJson = JSON.parse((await get(GB, "/vec-d123.htm?format=json")).body) as { canonicalUrl: string; shop: string };
  assert.equal(partnerJson.canonicalUrl, `https://www.alza.cz/vec-d123.htm?${CODE}`);
  assert.equal(partnerJson.shop, "cz");
  const plainJson = JSON.parse((await get("fxalza.cz", "/vec-d123.htm?format=json")).body) as { canonicalUrl: string };
  assert.equal(plainJson.canonicalUrl, "https://www.alza.cz/vec-d123.htm");
});

test("the code is only for Alza.cz, a Slovak link on the subdomain is an ordinary one", async () => {
  const { location } = await get(GB, "/alza.sk/vec-d123.htm");
  assert.equal(location, "https://www.alza.sk/vec-d123.htm?utm_source=fxalza&utm_medium=discord");
  const { body } = await get(GB, "/alza.sk/vec-d123.htm", DISCORD);
  assert.ok(!body.includes("idp=8435"));
  assert.ok(!body.includes("banner_id"));
  assert.equal((await get(GB, "/alza.sk/notebooky")).status, 404);
});

test("the other hosts carry no code", async () => {
  for (const host of ["fxalza.cz", "www.fxalza.cz"]) {
    assert.equal((await get(host, "/vec-d123.htm")).location, "https://www.alza.cz/vec-d123.htm?utm_source=fxalza&utm_medium=discord");
    const { body } = await get(host, "/vec-d123.htm", DISCORD);
    assert.ok(!body.includes("idp=8435"), host);
    assert.ok(body.includes(`<meta property="og:url" content="https://www.alza.cz/vec-d123.htm">`), host);
  }
  assert.equal((await get("fxalza.cz", "/")).status, 200);
  assert.equal((await get("fxalza.cz", "/notebooky/18842920.htm")).status, 404);
  // somebody else's own parameter on an ordinary link is carried as it always was
  assert.equal((await get("fxalza.cz", "/vec-d123.htm?idp=1")).location, "https://www.alza.cz/vec-d123.htm?idp=1");
});

test("a crawler of the bare subdomain gets the page of the site, a preview of it does not bounce through Alza", async () => {
  const { status, body } = await get(GB, "/", DISCORD);
  assert.equal(status, 200);
  assert.ok(body.includes(`<link rel="canonical" href="https://fxalza.cz/">`));
});
