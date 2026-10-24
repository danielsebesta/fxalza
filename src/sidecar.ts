import { spawn, type ChildProcessByStdio } from "node:child_process";
import { createInterface } from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Readable, Writable } from "node:stream";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, "../sidecar/cf-transport.py");

const WORKERS = Math.max(1, Number(process.env.SIDECAR_WORKERS ?? 6));
const MAX_QUEUE = Math.max(1, Number(process.env.SIDECAR_MAX_QUEUE ?? 200));
// A worker that let this many requests in a row time out is replaced; one that answered nothing since it started is given
// STARTUP_GRACE_MS first, because uv may still be installing curl_cffi on a cold machine.
const RESTART_AFTER_TIMEOUTS = Math.max(1, Number(process.env.SIDECAR_RESTART_AFTER_TIMEOUTS ?? 3));
const STARTUP_GRACE_MS = Number(process.env.SIDECAR_STARTUP_GRACE_MS ?? 90_000);
const RESPAWN_HOLDOFF_MS = 5000;

type SidecarProc = ChildProcessByStdio<Writable, Readable, null>;

export interface SidecarResponse {
  id: number;
  status: number;
  headers: Record<string, string>;
  body: string;
  error: string | null;
  // the body was cut by the sidecar because it was larger than it is willing to pass on
  truncated?: boolean;
}

interface Pending {
  resolve: (r: SidecarResponse) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  // the process the request was written to; a replacement process must not inherit its failures
  proc: SidecarProc;
}

export class OverloadedError extends Error {
  constructor() {
    super("sidecar overloaded");
  }
}

export interface SidecarStats {
  workers: number;
  alive: number;
  pending: number;
}

class Worker {
  proc: SidecarProc | null = null;
  pending = new Map<number, Pending>();
  private lastSpawn = 0;
  private spawnedAt = 0;
  private answered = false;
  private timeouts = 0;

  alive(): boolean {
    return this.proc !== null && !this.proc.killed && this.proc.exitCode === null && this.proc.stdin.writable;
  }

  ensure(): SidecarProc {
    if (this.proc && this.alive()) return this.proc;

    if (Date.now() - this.lastSpawn < RESPAWN_HOLDOFF_MS) {
      throw new Error("sidecar recently failed to start; not retrying yet");
    }
    this.lastSpawn = Date.now();
    this.spawnedAt = Date.now();
    this.answered = false;
    this.timeouts = 0;

    const proc = spawn("uv", ["run", "--with", "curl_cffi", "python", "-u", SCRIPT], { stdio: ["pipe", "pipe", "inherit"] });
    this.proc = proc;

    const rl = createInterface({ input: proc.stdout });
    rl.on("line", (line) => {
      let msg: SidecarResponse;
      try {
        msg = JSON.parse(line) as SidecarResponse;
      } catch {
        return;
      }
      this.answered = true;
      this.timeouts = 0;
      const p = this.pending.get(msg.id);
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(msg.id);
      p.resolve(msg);
    });

    const failAll = (why: string): void => {
      if (this.proc === proc) this.proc = null;
      for (const [id, p] of this.pending) {
        if (p.proc !== proc) continue;
        clearTimeout(p.timer);
        this.pending.delete(id);
        p.reject(new Error(`${why} before answering request #${id}`));
      }
    };
    proc.on("exit", (code, signal) => failAll(`sidecar exited (${signal ? `signal=${signal}` : `code=${code}`})`));
    proc.on("error", (e) => failAll(`sidecar failed to start (${e.message})`));
    proc.stdin.on("error", () => {});

    return proc;
  }

  // Called when a request written to this worker got no answer in time. A worker that used to answer and then fell silent
  // (Python stuck in a syscall, a wedged connection pool) is killed; its exit rejects what is still pending and the next
  // request starts a fresh process.
  noteTimeout(): void {
    if (!this.answered && Date.now() - this.spawnedAt < STARTUP_GRACE_MS) return;
    this.timeouts++;
    if (this.timeouts < RESTART_AFTER_TIMEOUTS) return;
    console.warn(`[sidecar] worker stopped answering (${this.timeouts} timeouts in a row), replacing it`);
    this.restart();
  }

  restart(): void {
    const proc = this.proc;
    this.proc = null;
    this.lastSpawn = 0;
    this.timeouts = 0;
    proc?.kill();
  }

  // Closing stdin lets the Python loop finish its current request and exit on its own, which also ends the uv wrapper
  // on Windows, where killing the wrapper leaves the interpreter behind. The kill is the fallback.
  stop(): void {
    const proc = this.proc;
    this.proc = null;
    if (!proc) return;
    try {
      proc.stdin.end();
    } catch {
    }
    setTimeout(() => {
      if (proc.exitCode === null) proc.kill();
    }, 2000).unref();
  }
}

export class Sidecar {
  private workers = Array.from({ length: WORKERS }, () => new Worker());
  private nextId = 1;

  private pick(): Worker {
    let best = this.workers[0]!;
    let total = 0;
    for (const w of this.workers) {
      total += w.pending.size;
      if (w.pending.size < best.pending.size) best = w;
    }
    if (total >= MAX_QUEUE) throw new OverloadedError();
    return best;
  }

  stats(): SidecarStats {
    let pending = 0;
    let alive = 0;
    for (const w of this.workers) {
      pending += w.pending.size;
      if (w.alive()) alive++;
    }
    return { workers: this.workers.length, alive, pending };
  }

  // Async so that a full queue or a worker that cannot be started come back as a rejected promise, never as a throw out of the call.
  async request(
    url: string,
    opts: { method?: string; headers?: Record<string, string>; timeoutMs?: number } = {},
  ): Promise<SidecarResponse> {
    const worker = this.pick();
    const proc = worker.ensure();
    const id = this.nextId++;
    const timeoutMs = opts.timeoutMs ?? 25000;

    return new Promise<SidecarResponse>((resolve, reject) => {
      const settle = (fail: Error | null, msg?: SidecarResponse): void => {
        if (!worker.pending.delete(id)) return;
        clearTimeout(timer);
        if (fail) reject(fail);
        else resolve(msg!);
      };
      const timer = setTimeout(() => {
        if (!worker.pending.has(id)) return;
        settle(new Error(`sidecar request #${id} timed out`));
        worker.noteTimeout();
      }, timeoutMs + 5000);

      worker.pending.set(id, { resolve, reject, timer, proc });
      const line = JSON.stringify({ id, url, method: opts.method ?? "GET", headers: opts.headers ?? {}, timeoutMs }) + "\n";
      proc.stdin.write(line, (err) => {
        if (err) settle(new Error(`sidecar request #${id} could not be sent (${err.message})`));
      });
    });
  }

  stop(): void {
    for (const w of this.workers) w.stop();
  }
}
