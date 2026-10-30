// A real Chrome in Browserbase's cloud, as the last resort when Cloudflare turns the plain providers away. A plain HTTP request
// (Browserbase's own Fetch included) gets the challenge page, a browser passes it, but the first page of a fresh session takes
// about 20 s. So the session is kept open and reused: later pages are a navigation away. It is closed after a while without
// requests, which also keeps the browser hours of the plan from running when nobody asks for anything.

const API = "https://api.browserbase.com/v1";
const IDLE_MS = Number(process.env.BROWSERBASE_IDLE_MS ?? 120_000);
const SESSION_TIMEOUT_S = Number(process.env.BROWSERBASE_SESSION_TIMEOUT_S ?? 900);
const CHALLENGE_MS = 40_000;

export const browserbaseEnabled = (): boolean => !!process.env.BROWSERBASE_API_KEY;

function headers(): Record<string, string> {
  return { "x-bb-api-key": process.env.BROWSERBASE_API_KEY ?? "", "content-type": "application/json" };
}

interface CdpMessage {
  id?: number;
  method?: string;
  params?: any;
  result?: any;
  error?: { message: string };
  sessionId?: string;
}

class Cdp {
  private ws: WebSocket;
  private next = 1;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private listeners = new Set<(m: CdpMessage) => void>();
  closed = false;

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.addEventListener("message", (ev) => {
      const m = JSON.parse(String(ev.data)) as CdpMessage;
      if (m.id !== undefined) {
        const p = this.pending.get(m.id);
        this.pending.delete(m.id);
        if (p) m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
      } else for (const l of this.listeners) l(m);
    });
    ws.addEventListener("close", () => {
      this.closed = true;
      for (const p of this.pending.values()) p.reject(new Error("browserbase: connection closed"));
      this.pending.clear();
    });
  }

  static connect(url: string): Promise<Cdp> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const timer = setTimeout(() => reject(new Error("browserbase: connect timeout")), 20_000);
      ws.addEventListener("open", () => {
        clearTimeout(timer);
        resolve(new Cdp(ws));
      });
      ws.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("browserbase: connect failed"));
      });
    });
  }

  send(method: string, params: object = {}, sessionId?: string): Promise<any> {
    if (this.closed) return Promise.reject(new Error("browserbase: connection closed"));
    const id = this.next++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  on(l: (m: CdpMessage) => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  close(): void {
    this.closed = true;
    this.ws.close();
  }
}

interface Live {
  id: string;
  cdp: Cdp;
}

let live: Promise<Live> | null = null;
let idle: ReturnType<typeof setTimeout> | undefined;
let inUse = 0;

async function release(l: Live): Promise<void> {
  l.cdp.close();
  await fetch(`${API}/sessions/${l.id}`, { method: "POST", headers: headers(), body: JSON.stringify({ status: "REQUEST_RELEASE" }) }).catch(() => {});
  console.log(`[browserbase] session ${l.id} released`);
}

function armIdle(l: Live): void {
  clearTimeout(idle);
  idle = setTimeout(() => {
    if (inUse > 0) return armIdle(l);
    if (live) live = null;
    void release(l);
  }, IDLE_MS);
}

async function open(): Promise<Live> {
  const started = Date.now();
  const res = await fetch(`${API}/sessions`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ timeout: SESSION_TIMEOUT_S, ...(process.env.BROWSERBASE_PROJECT_ID ? { projectId: process.env.BROWSERBASE_PROJECT_ID } : {}) }),
  });
  if (!res.ok) throw new Error(`browserbase: HTTP ${res.status} creating a session`);
  const s = (await res.json()) as { id: string; connectUrl: string };
  const cdp = await Cdp.connect(s.connectUrl);
  const l = { id: s.id, cdp };
  cdp.on(() => {});
  console.log(`[browserbase] session ${s.id} opened in ${Date.now() - started}ms`);
  return l;
}

function session(): Promise<Live> {
  if (!live) {
    const p = open().catch((e) => {
      if (live === p) live = null;
      throw e;
    });
    live = p;
  }
  return live.then((l) => {
    if (l.cdp.closed) {
      live = null;
      return session();
    }
    armIdle(l);
    return l;
  });
}

// Opens `url` in a tab of its own, waits out the Cloudflare check and returns what the page shows: the HTML for a page, the
// text for an API address (Chrome shows a JSON answer as text).
export async function browserbaseRun(url: string, timeoutMs: number, signal: AbortSignal): Promise<{ status: number; body: string }> {
  const l = await session();
  inUse++;
  let target: string | undefined;
  let sid: string | undefined;
  try {
    const t = await l.cdp.send("Target.createTarget", { url: "about:blank" });
    target = t.targetId;
    sid = (await l.cdp.send("Target.attachToTarget", { targetId: target, flatten: true })).sessionId as string;
    await l.cdp.send("Page.enable", {}, sid);
    await l.cdp.send("Network.enable", {}, sid);

    // the check page answers first (with a 403), the page behind it last, and that is the one that counts
    let status = 0;
    const off = l.cdp.on((m) => {
      if (m.sessionId === sid && m.method === "Network.responseReceived" && m.params.type === "Document") status = m.params.response.status;
    });
    const nav = await l.cdp.send("Page.navigate", { url }, sid);
    if (nav.errorText) throw new Error(`browserbase: ${nav.errorText}`);

    const evaluate = async (expression: string): Promise<string> => {
      const r = await l.cdp.send("Runtime.evaluate", { expression, returnByValue: true }, sid);
      return typeof r.result?.value === "string" ? r.result.value : "";
    };
    const api = new URL(url).hostname.startsWith("webapi.");
    const deadline = Date.now() + Math.min(timeoutMs, CHALLENGE_MS);
    // One expression decides and reads, so a page that replaces the check page between two calls cannot be taken for the answer.
    const read =
      "(function(){if(document.readyState==='loading'||location.href==='about:blank'||/Just a moment/i.test(document.title))return '';return " +
      (api ? "document.body?document.body.innerText:''" : "document.documentElement.outerHTML") +
      "})()";
    let body = "";
    try {
      while (Date.now() < deadline) {
        if (signal.aborted) throw signal.reason;
        body = await evaluate(read);
        if (body) break;
        await new Promise((r) => setTimeout(r, 400));
      }
    } finally {
      off();
    }
    if (!body) throw new Error("browserbase: the page did not get past the check in time");
    return { status: status || 200, body };
  } finally {
    inUse--;
    if (target) void l.cdp.send("Target.closeTarget", { targetId: target }).catch(() => {});
  }
}

export function stopBrowserbase(): void {
  clearTimeout(idle);
  const p = live;
  live = null;
  void p?.then(release).catch(() => {});
}
