#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";

const token = process.env.DISCORD_BOT_TOKEN;
const guild = process.env.DISCORD_GUILD_ID;
if (!token || !guild) {
  console.error("Chybí DISCORD_BOT_TOKEN nebo DISCORD_GUILD_ID (viz .env.example).");
  process.exit(1);
}
const force = process.argv.includes("--force");
const dir = new URL("../assets/emoji/", import.meta.url);
const api = `https://discord.com/api/v10/guilds/${guild}/emojis`;
const auth = { Authorization: `Bot ${token}` };

async function call(url, init = {}) {
  for (;;) {
    const headers = init.body ? { ...auth, "Content-Type": "application/json" } : auth;
    const r = await fetch(url, { ...init, headers });
    if (r.status === 429) {
      const { retry_after = 1 } = await r.json();
      await new Promise((res) => setTimeout(res, retry_after * 1000 + 100));
      continue;
    }
    if (!r.ok) throw new Error(`${init.method ?? "GET"} ${url} -> ${r.status} ${await r.text()}`);
    return r.status === 204 ? null : r.json();
  }
}

const readJson = (name) => (existsSync(new URL(name, dir)) ? JSON.parse(readFileSync(new URL(name, dir), "utf8")) : {});
const oldHashes = readJson(".hashes.json");
const existing = new Map((await call(api)).map((e) => [e.name, e.id]));
const ids = {};
const hashes = {};

for (const file of readdirSync(dir).filter((f) => f.endsWith(".png") && !f.startsWith("_"))) {
  const name = file.replace(/\.png$/, "");
  const png = readFileSync(new URL(file, dir));
  const sha = createHash("sha1").update(png).digest("hex");
  hashes[name] = sha;
  const have = existing.get(name);
  if (have && oldHashes[name] === sha && !force) {
    ids[name] = have;
    console.log(`= ${name}`);
    continue;
  }
  if (have) await call(`${api}/${have}`, { method: "DELETE" });
  const image = `data:image/png;base64,${png.toString("base64")}`;
  const e = await call(api, { method: "POST", body: JSON.stringify({ name, image }) });
  ids[name] = e.id;
  console.log(`${have ? "~" : "+"} ${name} ${e.id}`);
}
writeFileSync(new URL("ids.json", dir), JSON.stringify(ids, null, 2) + "\n");
writeFileSync(new URL(".hashes.json", dir), JSON.stringify(hashes, null, 2) + "\n");
console.log("zapsáno assets/emoji/ids.json");
