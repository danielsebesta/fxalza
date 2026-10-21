import { spawn, type ChildProcessByStdio } from "node:child_process";
import { createInterface } from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Readable, Writable } from "node:stream";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, "../sidecar/cf-transport.py");

const WORKERS = Math.max(1, Number(process.env.SIDECAR_WORKERS ?? 6));
const MAX_QUEUE = Math.max(1, Number(process.env.SIDECAR_MAX_QUEUE ?? 200));

type SidecarProc = ChildProcessByStdio<Writable, Readable, null>;

export interface SidecarResponse {
  id: number;
  status: number;
  headers: Record<string, string>;
  body: string;
  error: string | null;
}

interface Pending {
  resolve: (r: SidecarResponse) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class OverloadedError extends Error {
  constructor() {
    super("sidecar overloaded");
  }
}

class Worker {
  proc: SidecarProc | null = null;
  pending = new Map<number, Pending>();
  private lastSpawn = 0;

  ensure(): SidecarProc {
    if (this.proc && !this.proc.killed && this.proc.exitCode === null) return this.proc;

    if (Date.now() - this.lastSpawn < 5000) {
      throw new Error("sidecar recently failed to start; not retrying yet");
    }
    this.lastSpawn = Date.now();

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
      const p = this.pending.get(msg.id);
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(msg.id);
      p.resolve(msg);
    });

    const failAll = (why: string): void => {
      if (this.proc === proc) this.proc = null;
      for (const [id, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(new Error(`${why} before answering request #${id}`));
      }
      this.pending.clear();
    };
    proc.on("exit", (code) => failAll(`sidecar exited (code=${code})`));
    proc.on("error", (e) => failAll(`sidecar failed to start (${e.message})`));
    proc.stdin.on("error", () => {});

    return proc;
  }

  stop(): void {
    this.proc?.kill();
    this.proc = null;
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

  request(
    url: string,
    opts: { method?: string; headers?: Record<string, string>; timeoutMs?: number } = {},
  ): Promise<SidecarResponse> {
    const worker = this.pick();
    const proc = worker.ensure();
    const id = this.nextId++;
    const timeoutMs = opts.timeoutMs ?? 25000;

    return new Promise<SidecarResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        worker.pending.delete(id);
        reject(new Error(`sidecar request #${id} timed out`));
      }, timeoutMs + 5000);

      worker.pending.set(id, { resolve, reject, timer });
      proc.stdin.write(
        JSON.stringify({ id, url, method: opts.method ?? "GET", headers: opts.headers ?? {}, timeoutMs }) + "\n",
      );
    });
  }

  stop(): void {
    for (const w of this.workers) w.stop();
  }
}
