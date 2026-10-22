import assert from "node:assert/strict";
import { test } from "node:test";
import { demoHtml, landingCsp, landingHtml, problemHtml, robotsTxt, sitemapXml } from "../src/landing.ts";
import { landingTexts } from "../src/landing-i18n.ts";
import { ALL_SHOPS, SHOPS, siteHost } from "../src/shops.ts";

const textOf = (html: string): string => html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ");

test("every shop has a landing page in its own language and under its own address", () => {
  for (const shop of ALL_SHOPS) {
    const html = landingHtml(shop);
    const t = landingTexts(shop.lang);
    assert.ok(html.includes(`<html lang="${shop.locale}">`), shop.code);
    assert.ok(html.includes(`<title>${t.title}</title>`), shop.code);
    assert.ok(html.includes(`<link rel="canonical" href="https://${siteHost(shop)}/">`), shop.code);
    assert.ok(html.includes(`content="${shop.locale.replace("-", "_")}"`), shop.code);
    assert.ok(html.includes(t.script.enter), shop.code);
    assert.ok(html.includes(`alza.${shop.tld}/…-d1234567.htm`), shop.code);
  }
});

test("the name in the hero carries the subdomain in the dim colour of the .cz", () => {
  const hero = (html: string) => /<h1>(.*?)<\/h1>/.exec(html)![1];
  assert.equal(hero(landingHtml(SHOPS.cz)), '<span class="fx">fx</span>alza<span class="tld">.cz</span>');
  assert.equal(hero(landingHtml(SHOPS.sk)), '<span class="tld">sk.</span><span class="fx">fx</span>alza<span class="tld">.cz</span>');
  assert.equal(hero(landingHtml(SHOPS.at)), '<span class="tld">at.</span><span class="fx">fx</span>alza<span class="tld">.cz</span>');
});

test("the text of the page is in the language of the shop and the others are not mixed in", () => {
  const body = (code: keyof typeof SHOPS) => textOf(landingHtml(SHOPS[code]));
  assert.ok(body("sk").includes("Ako na to") && !body("sk").includes("Jak na to"));
  assert.ok(body("hu").includes("Hogyan működik") && !body("hu").includes("Ako na to"));
  assert.ok(body("de").includes("So geht's") && body("at").includes("So geht's"));
  assert.ok(body("cz").includes("Jak na to"));
  // the way to write the link names the shop and where it lives
  assert.ok(landingHtml(SHOPS.sk).includes("<code>alza.sk</code>") && landingHtml(SHOPS.sk).includes("<code>sk.fxalza.cz</code>"));
  // the price history button is only credited where it exists, in the Czech and Slovak shop
  assert.ok(landingHtml(SHOPS.cz).includes("hlidacshopu.cz") && landingHtml(SHOPS.sk).includes("hlidacshopu.cz"));
  assert.ok(!landingHtml(SHOPS.hu).includes("hlidacshopu.cz") && !landingHtml(SHOPS.de).includes("hlidacshopu.cz"));
});

test("every language has a script, a hash and links that go to the address of the shop", () => {
  const hashes = new Set<string>();
  for (const shop of ALL_SHOPS) {
    const html = landingHtml(shop);
    const csp = landingCsp(shop.lang);
    const script = /<script>([\s\S]*?)<\/script>/.exec(html)![1]!;
    assert.ok(csp.includes("script-src 'sha256-"), shop.code);
    hashes.add(csp);
    assert.ok(script.includes(landingTexts(shop.lang).script.notProduct), shop.code);
    for (const other of ALL_SHOPS) assert.ok(script.includes(`"${other.tld}":"${siteHost(other)}"`), `${shop.code} -> ${other.code}`);
  }
  assert.equal(hashes.size, 4);
});

test("the pages for a problem are in the language of the shop too", () => {
  const p = landingTexts("hu").problems;
  const html = problemHtml(p.rateTitle, p.rateBody, SHOPS.hu);
  assert.ok(html.includes('<html lang="hu-HU">') && html.includes(p.back));
  assert.ok(landingTexts("sk").problems.notProductBody("alza.sk", "sk.fxalza.cz").includes("alza.sk"));
  assert.ok(landingTexts("de").problems.unsupportedBody("pl", "Alza.cz").includes("alza.pl"));
});

test("a translated version says in its footer that the original is the Czech site and that the translation is machine made", () => {
  for (const code of ["sk", "hu", "de", "at"] as const) {
    const footer = /<footer>([\s\S]*?)<\/footer>/.exec(landingHtml(SHOPS[code]))![1]!;
    assert.ok(footer.includes('<a href="https://fxalza.cz/" hreflang="cs">fxalza.cz</a>'), code);
    assert.ok(footer.includes(landingTexts(SHOPS[code].lang).machineTranslation("").slice(0, 8)), code);
  }
  assert.ok(!/<footer>[\s\S]*hreflang="cs"[\s\S]*<\/footer>/.test(landingHtml(SHOPS.cz)));
});

test("the disclaimer names the domain of the shop, the Austrian one too", () => {
  for (const shop of ALL_SHOPS) {
    const footer = /<footer>([\s\S]*?)<\/footer>/.exec(landingHtml(shop))![1]!;
    assert.ok(footer.includes(`Alza.${shop.tld}`), shop.code);
    assert.ok(!footer.includes("{tld}"), shop.code);
  }
  assert.ok(!/<footer>[\s\S]*Alza\.de[\s\S]*<\/footer>/.test(landingHtml(SHOPS.at)));
});

test("every shop has a robots.txt and a sitemap that name only its own host", () => {
  for (const shop of ALL_SHOPS) {
    assert.ok(robotsTxt(shop).includes(`Sitemap: https://${siteHost(shop)}/sitemap.xml`), shop.code);
    const xml = sitemapXml(shop);
    assert.equal([...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]).join(), `https://${siteHost(shop)}/`, shop.code);
  }
});

test("the demo of a shop shows products of that shop, linked under its own address and in its own words", () => {
  for (const shop of ALL_SHOPS.filter((s) => s.code !== "cz")) {
    const html = demoHtml(shop);
    const links = [...html.matchAll(/https:\/\/[a-z.]*fxalza\.cz\/[^<"]*/g)].map((m) => new URL(m[0]).hostname);
    assert.ok(links.length >= 4, shop.code);
    assert.ok(links.every((h) => h === siteHost(shop)), `${shop.code}: ${[...new Set(links)].join()}`);
    assert.ok(html.includes(`<html lang="${shop.locale}">`), shop.code);
    assert.ok(html.includes(landingTexts(shop.lang).script.today), shop.code);
    // no Czech price and no Czech button in a demo that is not the Czech one
    assert.ok(!html.includes(" Kč") && !html.includes("Otevřít na Alze"), shop.code);
  }
  assert.ok(demoHtml(SHOPS.cz).includes("Otevřít na Alze"));
});
