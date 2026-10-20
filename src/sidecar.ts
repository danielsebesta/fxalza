import { spawn, type ChildProcessByStdio } from "node:child_process";
import { createInterface } from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Readable, Writable } from "node:stream";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, "../sidecar/cf-transport.py");

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

export class Sidecar {
  private proc: SidecarProc | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private lastSpawn = 0;

  private cmd(): string[] {
    const custom = process.env.CF_SIDECAR_CMD;
    if (custom) return custom.split(" ").filter(Boolean);
    return ["uv", "run", "--with", "curl_cffi", "python", "-u", SCRIPT];
  }

  private ensure(): SidecarProc {
    if (this.proc && !this.proc.killed && this.proc.exitCode === null) return this.proc;

    if (Date.now() - this.lastSpawn < 5000) {
      throw new Error("sidecar recently failed to start; not retrying yet");
    }
    this.lastSpawn = Date.now();

    const [bin, ...args] = this.cmd();
    const proc = spawn(bin, args, { stdio: ["pipe", "pipe", "inherit"] });
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

    return proc;
  }

  request(
    url: string,
    opts: { method?: string; headers?: Record<string, string>; timeoutMs?: number } = {},
  ): Promise<SidecarResponse> {
    const proc = this.ensure();
    const id = this.nextId++;
    const timeoutMs = opts.timeoutMs ?? 25000;

    return new Promise<SidecarResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`sidecar request #${id} timed out`));
      }, timeoutMs + 5000);

      this.pending.set(id, { resolve, reject, timer });
      proc.stdin.write(
        JSON.stringify({ id, url, method: opts.method ?? "GET", headers: opts.headers ?? {}, timeoutMs }) + "\n",
      );
    });
  }

  stop(): void {
    this.proc?.kill();
    this.proc = null;
  }
}
