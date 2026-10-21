// Mirrors console output into data/logs/latest.log. Finished logs are gzipped as <date>-<n>.log.gz, like a Minecraft server does.
// LOG_DIR overrides the folder (empty turns file logging off), LOG_MAX_MB caps latest.log within a day, LOG_KEEP_DAYS prunes old archives.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { format } from "node:util";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIR = process.env.LOG_DIR === undefined ? path.resolve(__dirname, "../data/logs") : process.env.LOG_DIR && path.resolve(process.env.LOG_DIR);
const MAX_BYTES = Number(process.env.LOG_MAX_MB ?? 50) * 1024 * 1024;
const KEEP_DAYS = Number(process.env.LOG_KEEP_DAYS ?? 30);
const LATEST = DIR ? path.join(DIR, "latest.log") : "";
const PENDING = /^(\d{4}-\d\d-\d\d)-pending-\d+\.log$/;

const utcDay = (t = Date.now()): string => new Date(t).toISOString().slice(0, 10);

let fd: number | null = null;
let size = 0;
let day = utcDay();

function archiveName(forDay: string): string {
  for (let n = 1; ; n++) {
    const name = path.join(DIR, `${forDay}-${n}.log.gz`);
    if (!fs.existsSync(name)) return name;
  }
}

async function compress(source: string, forDay: string): Promise<void> {
  const target = archiveName(forDay);
  try {
    await pipeline(fs.createReadStream(source), createGzip({ level: 9 }), fs.createWriteStream(`${target}.tmp`));
    fs.renameSync(`${target}.tmp`, target);
    fs.rmSync(source, { force: true });
  } catch (e) {
    fs.rmSync(`${target}.tmp`, { force: true });
    console.warn(`[log] could not compress ${path.basename(source)}: ${e instanceof Error ? e.message : e}`);
  }
}

function prune(): void {
  if (!(KEEP_DAYS > 0)) return;
  const cutoff = Date.now() - KEEP_DAYS * 86_400_000;
  for (const name of fs.readdirSync(DIR)) {
    if (!name.endsWith(".log.gz")) continue;
    const file = path.join(DIR, name);
    try {
      if (fs.statSync(file).mtimeMs < cutoff) fs.rmSync(file);
    } catch {
    }
  }
}

// Moves latest.log out of the way (it is archived in the background) and starts an empty one.
function rotate(forDay: string): void {
  if (fd !== null) fs.closeSync(fd);
  fd = null;
  if (fs.existsSync(LATEST) && fs.statSync(LATEST).size > 0) {
    const pending = path.join(DIR, `${forDay}-pending-${Date.now()}.log`);
    fs.renameSync(LATEST, pending);
    void compress(pending, forDay).then(prune);
  }
  fd = fs.openSync(LATEST, "a");
  size = 0;
}

function write(level: string, args: unknown[]): void {
  if (fd === null) return;
  try {
    const text = format(...args);
    const stamped = /^\d{4}-\d\d-\d\dT[\d:.]+Z /.test(text);
    const line = stamped ? `${text.slice(0, text.indexOf(" "))} ${level} ${text.slice(text.indexOf(" ") + 1)}\n` : `${new Date().toISOString()} ${level} ${text}\n`;
    const today = utcDay();
    if (today !== day) {
      rotate(day);
      day = today;
    } else if (size + Buffer.byteLength(line) > MAX_BYTES) {
      rotate(day);
    }
    if (fd === null) return;
    size += fs.writeSync(fd, line);
  } catch {
    fd = null;
  }
}

if (DIR) {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    // Leftovers from a crash during compression, then the previous run's latest.log.
    for (const name of fs.readdirSync(DIR)) {
      const m = PENDING.exec(name);
      if (m) void compress(path.join(DIR, name), m[1]!);
    }
    rotate(fs.existsSync(LATEST) ? utcDay(fs.statSync(LATEST).mtimeMs) : day);
    prune();
    for (const [method, level] of [["log", "INFO"], ["info", "INFO"], ["warn", "WARN"], ["error", "ERROR"]] as const) {
      const original = console[method].bind(console);
      console[method] = (...args: unknown[]) => {
        original(...args);
        write(level, args);
      };
    }
    console.log(`[log] writing to ${LATEST}, archives are gzipped per day and kept for ${KEEP_DAYS} days`);
  } catch (e) {
    console.warn(`[log] cannot write to ${DIR}: ${e instanceof Error ? e.message : e}`);
  }
}
