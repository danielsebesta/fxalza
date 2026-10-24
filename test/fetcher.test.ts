import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchWith, type Provider } from "../src/fetcher.ts";

const URL_ = "https://www.alza.sk/x-d1.htm";
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function provider(name: string, ms: number, status = 200, calls: string[] = []): Provider {
  return {
    name,
    enabled: () => true,
    async run() {
      calls.push(name);
      await wait(ms);
      return { status, body: `<html>${name}</html>` };
    },
  };
}

test("the sidecar goes first and alone when it answers", async () => {
  const calls: string[] = [];
  const res = await fetchWith([provider("sidecar", 5, 200, calls), provider("paid-a1", 5, 200, calls)], URL_, {}, 50);
  assert.equal(res.via, "sidecar");
  assert.deepEqual(calls, ["sidecar"]);
});

test("a slow paid provider is joined by the next one and the first usable answer wins", async () => {
  const calls: string[] = [];
  const started = Date.now();
  const res = await fetchWith(
    [provider("sidecar", 5, 403, calls), provider("paid-b1", 1500, 200, calls), provider("paid-b2", 20, 200, calls)],
    URL_,
    {},
    100,
  );
  assert.equal(res.via, "paid-b2");
  assert.deepEqual(calls, ["sidecar", "paid-b1", "paid-b2"]);
  assert.ok(Date.now() - started < 600, "did not wait for the slow provider");
});

test("a paid provider that answers within the hedge delay is the only one called", async () => {
  const calls: string[] = [];
  const res = await fetchWith([provider("sidecar", 5, 403, calls), provider("paid-c1", 20, 200, calls), provider("paid-c2", 20, 200, calls)], URL_, {}, 300);
  assert.equal(res.via, "paid-c1");
  assert.deepEqual(calls, ["sidecar", "paid-c1"]);
});

test("a failing provider hands over straight away, without waiting for the hedge delay", async () => {
  const calls: string[] = [];
  const started = Date.now();
  const res = await fetchWith([provider("sidecar", 5, 403, calls), provider("paid-d1", 5, 429, calls), provider("paid-d2", 5, 200, calls)], URL_, {}, 2000);
  assert.equal(res.via, "paid-d2");
  assert.ok(Date.now() - started < 500);
});

test("a hedged provider that loses is told to stop, and its abort is not held against it", async () => {
  const aborted: string[] = [];
  const slow: Provider = {
    name: "paid-f1",
    enabled: () => true,
    run: (_url, _opts, _timeout, signal) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve({ status: 200, body: "<html>slow</html>" }), 300);
        signal.addEventListener("abort", () => {
          clearTimeout(timer);
          aborted.push("paid-f1");
          reject(signal.reason);
        });
      }),
  };
  const res = await fetchWith([provider("sidecar", 5, 403), slow, provider("paid-f2", 20, 200)], URL_, {}, 50);
  assert.equal(res.via, "paid-f2");
  await wait(20);
  assert.deepEqual(aborted, ["paid-f1"]);
  // the aborted provider is still runnable: it answers the next call on its own
  const again = await fetchWith([slow], URL_, {}, 50).catch((e: Error) => e);
  assert.ok(!(again instanceof Error), "an aborted loser must not be put on cooldown");
});

test("the last unusable answer is returned when nothing is usable, and an error when nothing answered", async () => {
  const none = await fetchWith([provider("sidecar", 5, 403), provider("paid-e1", 5, 403)], URL_, {}, 50);
  assert.equal(none.status, 403);
  const broken: Provider = { name: "paid-e2", enabled: () => true, run: () => Promise.reject(new Error("boom")) };
  await assert.rejects(fetchWith([broken], URL_, {}, 50), /boom/);
});
