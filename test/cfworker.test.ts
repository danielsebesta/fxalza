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

const stub = (name: string, status: number, calls: string[], free = false): Provider => ({
  name,
  free,
  enabled: () => true,
  run: async () => {
    calls.push(name);
    return { status, body: `<html>${name}</html>` };
  },
});

test("our own workers go before the sidecar, which is left alone when they answer", async () => {
  const calls: string[] = [];
  const list = [stub("sidecar", 200, calls), stub("cfworker", 200, calls, true), stub("cfworker2", 200, calls, true), stub("paid", 200, calls)];
  const r = await fetchWith(list, "https://www.alza.cz/x-d1.htm", {}, 50);
  assert.equal(r.via, "cfworker");
  assert.deepEqual(calls, ["cfworker"]);
});

test("the sidecar comes after the workers and before the paid providers", async () => {
  const calls: string[] = [];
  const list = [stub("sidecar", 200, calls), stub("cfworker", 403, calls, true), stub("cfworker2", 403, calls, true), stub("paid", 200, calls)];
  const r = await fetchWith(list, "https://www.alza.cz/x-d1.htm", {}, 50);
  assert.equal(r.via, "sidecar");
  assert.deepEqual(calls, ["cfworker", "cfworker2", "sidecar"]);
});
