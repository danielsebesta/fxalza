import assert from "node:assert/strict";
import { test } from "node:test";
import { hasCacheBustSuffix, isExtensionHost, parseProductPath, withoutLanguagePrefix } from "../src/parse.ts";

test("parses slug product paths", () => {
  assert.deepEqual(parseProductPath("/sport/bery-jones-100-g-d10786234.htm"), {
    id: "10786234",
    path: "/sport/bery-jones-100-g-d10786234.htm",
  });
});

test("parses bare ids", () => {
  assert.deepEqual(parseProductPath("/d123"), { id: "123", path: "/-d123.htm" });
  assert.deepEqual(parseProductPath("/123/"), { id: "123", path: "/-d123.htm" });
});

test("rejects non-product paths and absurd ids", () => {
  assert.equal(parseProductPath("/"), null);
  assert.equal(parseProductPath("/neco"), null);
  assert.equal(parseProductPath("/x-d1234567890123.htm"), null);
});

test("the language of an Alza link is dropped, so every link stays in the default language of the domain", () => {
  assert.equal(withoutLanguagePrefix("/EN/24-aoc-24g4hre-d13041842.htm"), "/24-aoc-24g4hre-d13041842.htm");
  assert.equal(withoutLanguagePrefix("/de/gaming/hogwarts-legacy"), "/gaming/hogwarts-legacy");
  assert.equal(withoutLanguagePrefix("/en/d322.htm"), "/d322.htm");
  assert.equal(withoutLanguagePrefix("/EN"), "/");
  assert.equal(withoutLanguagePrefix("/EN/"), "/");
  assert.equal(withoutLanguagePrefix("/EN/EN/24-aoc-24g4hre-d13041842.htm"), "/24-aoc-24g4hre-d13041842.htm");
  // a prefix behind the host of a pasted link is not the start of this path, the server drops it on its second walk
  assert.equal(withoutLanguagePrefix("/alza.sk/EN/24-aoc-24g4hre-d13041842.htm"), "/alza.sk/EN/24-aoc-24g4hre-d13041842.htm");
  // real roots of a shop stay as they are, lowercase ones too
  assert.equal(withoutLanguagePrefix("/kod/aoc;12345"), "/kod/aoc;12345");
  assert.equal(withoutLanguagePrefix("/aoc/v1432.htm"), "/aoc/v1432.htm");
  assert.equal(withoutLanguagePrefix("/pc/d322.htm"), "/pc/d322.htm");
  assert.equal(withoutLanguagePrefix("/"), "/");
  assert.equal(withoutLanguagePrefix("/EN%2F24-aoc-24g4hre-d13041842.htm"), "/EN%2F24-aoc-24g4hre-d13041842.htm");
});

test("never lets the path change the upstream host", () => {
  for (const evil of ["//evil.com/x-d1.htm", "/@evil.com/x-d1.htm", "/\evil.com/x-d1.htm", "/..%2f..%2fx-d1.htm"]) {
    const p = parseProductPath(evil);
    if (p) assert.ok(!p.path.includes("@") && !p.path.includes(String.fromCharCode(92)) && new URL(`https://www.alza.cz${p.path}`).hostname === "www.alza.cz");
  }
});

test("any suffix after the product link still resolves to the same product", () => {
  for (const suffix of ["", "x", "a", ".html", "-x", "/", "xyz"]) {
    const parsed = parseProductPath(`/vention-power-bank-d12352171.htm${suffix}`);
    assert.deepEqual(parsed, { id: "12352171", path: "/vention-power-bank-d12352171.htm" }, suffix);
  }
});

test("only a changed link counts as a cache bust", () => {
  assert.equal(hasCacheBustSuffix("/vention-power-bank-d12352171.htm"), false);
  assert.equal(hasCacheBustSuffix("/vention-power-bank-d12352171"), false);
  assert.equal(hasCacheBustSuffix("/vention-power-bank-d12352171.htm/"), false);
  assert.equal(hasCacheBustSuffix("/d12352171"), false);
  assert.equal(hasCacheBustSuffix("/12352171"), false);
  assert.equal(hasCacheBustSuffix("/vention-power-bank-d12352171.htmx"), true);
  assert.equal(hasCacheBustSuffix("/vention-power-bank-d12352171.htm1"), true);
  assert.equal(hasCacheBustSuffix("/vention-power-bank-d12352171x"), true);
});

test("takes the product id from ?dq= when the path has none", () => {
  assert.deepEqual(parseProductPath("/gaming/grand-theft-auto-v-gta-5", "6496142"), { id: "6496142", path: "/-d6496142.htm" });
  assert.equal(parseProductPath("/gaming/grand-theft-auto-v-gta-5", "abc"), null);
  assert.equal(parseProductPath("/gaming/grand-theft-auto-v-gta-5", null), null);
  assert.equal(parseProductPath("/", "6496142"), null);
  assert.equal(parseProductPath("/neco-d111.htm", "222")?.id, "111");
});

test("the extension subdomains of the apex are recognised, nothing else is", () => {
  for (const sub of ["rozsireni", "extension", "script", "ext", "prohlizec", "browser"]) {
    assert.equal(isExtensionHost(`${sub}.fxalza.cz`, "fxalza.cz"), true, sub);
  }
  assert.equal(isExtensionHost("fxalza.cz", "fxalza.cz"), false);
  assert.equal(isExtensionHost("www.fxalza.cz", "fxalza.cz"), false);
  assert.equal(isExtensionHost("ext.example.com", "fxalza.cz"), false);
  assert.equal(isExtensionHost("a.ext.fxalza.cz", "fxalza.cz"), false);
  assert.equal(isExtensionHost("notext.fxalza.cz", "fxalza.cz"), false);
});
