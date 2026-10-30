import test from "node:test";
import assert from "node:assert/strict";
import { fetchWith, parseCfWorkers, type Provider } from "../src/fetcher.ts";

test("workers come from CF_WORKERS in order, the first being the primary", () => {
  const w = parseCfWorkers("https://a.example.dev/|tok1, https://b.example.dev|tok2");
  assert.deepEqual(
    w.map((x) => [x.name, x.url, x.token]),
    [
      ["cfworker", "https://a.example.dev", "tok1"],
      ["cfworker2", "https://b.example.dev", "tok2"],
    ],
  );
});

test("an entry without https or without a token is ignored", () => {
  assert.equal(parseCfWorkers("http://a.example.dev|tok").length, 0);
  assert.equal(parseCfWorkers("https://a.example.dev|").length, 0);
  assert.equal(parseCfWorkers(undefined).length, 0);
});

test("a free provider that fails hands over to the next one", async () => {
  const providers: Provider[] = [
    { name: "free-a", free: true, enabled: () => true, run: async () => { throw new Error("free-a: HTTP 502"); } },
    { name: "free-b", free: true, enabled: () => true, run: async () => ({ status: 200, body: "ok" }) },
  ];
  const r = await fetchWith(providers, "https://www.alza.cz/x-d1.htm");
  assert.equal(r.via, "free-b");
  assert.equal(r.body, "ok");
});
