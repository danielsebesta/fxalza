import assert from "node:assert/strict";
import { test } from "node:test";
import { hasCacheBustSuffix, parseProductPath } from "../src/parse.ts";

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
