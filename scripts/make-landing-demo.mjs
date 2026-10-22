#!/usr/bin/env node
// Renders the Discord cards of the landing page demo from a running server (DEMO_BASE, 127.0.0.1:8484 by default).
//   node scripts/make-landing-demo.mjs [cz|sk|hu|de|at|all]
// Every shop has products of its own, in its own language, shown under the address of its own site.
import { createRequire } from "node:module";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import React from "react";
import { prerenderToNodeStream } from "react-dom/static";
import { landingTexts } from "../src/landing-i18n.ts";
import { SHOPS, siteHost } from "../src/shops.ts";

const require = createRequire(import.meta.url);
const { Component } = require("discord-html-transcripts-v2/dist/generator/renderers/components");
const Content = require("discord-html-transcripts-v2/dist/generator/renderers/content").default;
const { RenderType } = require("discord-html-transcripts-v2/dist/generator/renderers/content");
const Container = require("discord-html-transcripts-v2/dist/generator/renderers/components/Container").default;
const Section = require("discord-html-transcripts-v2/dist/generator/renderers/components/section/Section").default;
const Spacing = require("discord-html-transcripts-v2/dist/generator/renderers/components/Spacing").default;
const { globalStyles } = require("discord-html-transcripts-v2/dist/generator/renderers/components/styles");
const { DiscordMessages, DiscordMessage, DiscordAttachments } = require("@derockdev/discord-components-react");
const { renderToString } = require("@derockdev/discord-components-core/hydrate");

const BASE = process.env.DEMO_BASE ?? "http://127.0.0.1:8484";
const UA = "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The products of each demo, in the order of the tabs.
const DEMOS = {
  cz: {
    out: "landing-demo.html",
    products: [
      { id: "13067221", label: "Epson EcoTank L4360" },
      { id: "13450080", label: "Google Pixel 11" },
      { id: "7356338", label: "Govee LED pásek" },
      { id: "5509713", label: "AlzaPower kabel" },
    ],
  },
  sk: {
    out: "landing-demo.sk.html",
    products: [
      { id: "13367861", label: "LG OLED65C64LA" },
      { id: "12830053", label: "Siguro VT-H310W" },
      { id: "12821150", label: "SENCOR SRV 9085BK" },
      { id: "13199913", label: "TCL 50C6K" },
    ],
  },
  hu: {
    out: "landing-demo.hu.html",
    products: [
      { id: "13450080", label: "Google Pixel 11" },
      { id: "13190991", label: "Samsung Galaxy Watch Ultra" },
      { id: "13511710", label: "Xiaomi Robot Vacuum 6" },
      { id: "13175273", label: "Rapture BARGHEST" },
    ],
  },
  de: {
    out: "landing-demo.de.html",
    products: [
      { id: "13367861", label: "LG OLED65C64LA" },
      { id: "12830053", label: "Siguro VT-H310W" },
      { id: "13071860", label: "Dyson V16" },
      { id: "13440052", label: "Samsung Galaxy Watch9" },
    ],
  },
  at: {
    out: "landing-demo.at.html",
    products: [
      { id: "12830053", label: "Siguro VT-H310W" },
      { id: "13071860", label: "Dyson V16" },
      { id: "13440052", label: "Samsung Galaxy Watch9" },
      { id: "7958505", label: "Philips Series 3300" },
    ],
  },
};
const WANT = process.argv[2] ?? "cz";
if (WANT !== "all" && !DEMOS[WANT]) throw new Error(`neznámý obchod ${WANT}, použij ${Object.keys(DEMOS).join("|")}|all`);

// set for each demo in turn, the functions below read them
let SHOP;
let TXT;
let SHOWN_HOST;

const KIND_LABEL = { sale: "sleva", coupon: "slevový kód", cashback: "cashback", tradein: "výkupní bonus", alzaplus: "AlzaPlus+", promo: "akční cena", tier: "klubové ceny" };
const KIND_ORDER = Object.keys(KIND_LABEL);

// The limit for bots would answer a quick run with 429, so a request is repeated after a pause.
async function fetchOk(path, ua) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(BASE + path, { headers: { "user-agent": ua } });
    if (res.status !== 429) return res;
    await sleep(15000);
  }
  throw new Error(`${path}: pořád 429`);
}

const MIME = { jpg: "image/jpeg", webp: "image/webp", png: "image/png" };

// The thumbnail comes from assets/demo; a product that has none yet is downloaded once and kept there.
async function thumbnail(id, imageUrl) {
  for (const ext of Object.keys(MIME)) {
    const file = new URL(`../assets/demo/${id}.${ext}`, import.meta.url);
    if (existsSync(file)) return `data:${MIME[ext]};base64,` + readFileSync(file).toString("base64");
  }
  if (!imageUrl) throw new Error(`${id}: produkt nemá obrázek`);
  const res = await fetch(`${imageUrl}?width=180&height=180`, { headers: { accept: "image/jpeg,image/*" } });
  if (!res.ok) throw new Error(`${id}: obrázek vrátil ${res.status}`);
  const type = res.headers.get("content-type") ?? "";
  const ext = type.includes("webp") ? "webp" : type.includes("png") ? "png" : "jpg";
  const bytes = Buffer.from(await res.arrayBuffer());
  writeFileSync(new URL(`../assets/demo/${id}.${ext}`, import.meta.url), bytes);
  return `data:${MIME[ext]};base64,` + bytes.toString("base64");
}

async function loadProduct(p) {
  // the path form picks the shop without a Host header: /alza.sk/d123
  const prefix = SHOP.code === "cz" ? "" : `/alza.${SHOP.tld}`;
  const embed = await fetchOk(`${prefix}/d${p.id}`, UA);
  await sleep(3000);
  const json = await fetchOk(`${prefix}/d${p.id}?format=json`, "fxalza-landing-demo");
  if (!embed.ok || !json.ok) throw new Error(`${prefix}/d${p.id} -> ${embed.status}/${json.status} (běží server?)`);
  const m = (await embed.text()).match(/<script id="discord:component-embed" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) throw new Error(`${prefix}/d${p.id}: v odpovědi není discord:component-embed`);
  const data = await json.json();
  const thumb = await thumbnail(p.id, data.image);
  const slug = new URL(data.canonicalUrl).pathname;
  const kinds = KIND_ORDER.filter((k) => (data.benefits ?? []).some((x) => x.kind === k));
  await sleep(3000);
  return { ...p, component: JSON.parse(m[1]).component, thumb, slug, kinds, fetchedAt: data.fetchedAt };
}

const e = React.createElement;
const context = {
  messages: [],
  channel: {},
  type: RenderType.EMBED,
  callbacks: {
    resolveChannel: async () => null,
    resolveRole: async () => null,
    resolveUser: async () => null,
    resolveImageSrc: async (a) => a.url,
  },
};

const TEXT_STYLE = {
  fontFamily: "system-ui, sans-serif",
  fontSize: "14px",
  lineHeight: "1.375rem",
  color: "#d4d5d8",
  overflowWrap: "break-word",
};
const inline = (content) => e(Content, { content, context });

function TextBlock({ content }) {
  const out = [];
  const lines = content.split("\n");
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n];
    let h, sub;
    if (line.startsWith("- ")) {
      const items = [];
      while (n < lines.length && lines[n].startsWith("- ")) items.push(lines[n++].slice(2));
      n--;
      out.push(
        e(
          "ul",
          { key: n, style: { margin: "2px 0", paddingLeft: "1.1rem", listStyle: "disc" } },
          items.map((t, k) => e("li", { key: k, style: { paddingLeft: "2px" } }, inline(t))),
        ),
      );
    } else if ((h = line.match(/^(#{1,3}) (.*)$/))) {
      const size = { 1: "2rem", 2: "1.5rem", 3: "1.25rem" }[h[1].length];
      out.push(e("div", { key: n, style: { fontSize: size, fontWeight: 700, lineHeight: "1.375", margin: "8px 0 4px", color: "#dcdcdf" } }, inline(h[2])));
    } else if ((sub = line.match(/^-# (.*)$/))) {
      out.push(e("div", { key: n, style: { fontSize: "12px", lineHeight: "1rem", color: "#949ba4" } }, inline(sub[1])));
    } else if (line === "") {
      out.push(e("div", { key: n, style: { height: "1.375rem" } }));
    } else {
      out.push(e("div", { key: n }, inline(line)));
    }
  }
  return e("div", { style: TEXT_STYLE }, out);
}

function render(c, thumb, key = 0) {
  const kids = (c.components ?? []).map((x, k) => render(x, thumb, k));
  switch (c.type) {
    case 17:
      return e(Container, { key, accentColor: c.accent_color }, kids);
    case 9: {
      const accessory = c.accessory?.type === 11 ? { ...c.accessory, media: { url: thumb } } : undefined;
      return e(Section, { key, accessory, id: key, attachments: new Map() }, kids);
    }
    case 10:
      return e(TextBlock, { key, content: c.content });
    case 14:
      return e(Spacing, { key, spacing: c.spacing ?? 1, divider: c.divider ?? true });
    case 1:
      return e("div", { key, style: { display: "flex", gap: "8px", marginTop: "8px" } }, c.components.map((x, k) => e(Component, { key: k, component: x, id: k, attachments: new Map() })));
    default:
      return null;
  }
}

async function renderProduct(p) {
  const link = `https://${SHOWN_HOST}${p.slug}`;
  const tree = e(
    "html",
    null,
    e("head", null, e("meta", { charSet: "utf-8" })),
    e(
      "body",
      { style: { margin: 0 } },
      e(
        DiscordMessages,
        null,
        e("style", { dangerouslySetInnerHTML: { __html: globalStyles } }),
        e(
          DiscordMessage,
          { author: "samsepi0l", avatar: "https://cdn.discordapp.com/embed/avatars/0.png", timestamp: "2026-10-18T21:45:00.000Z" },
          e("a", { href: link, style: { color: "#2781e7", textDecoration: "none" } }, link),
          e(DiscordAttachments, { slot: "components" }, render(p.component, p.thumb)),
        ),
      ),
    ),
  );
  const chunks = [];
  const { prelude } = await prerenderToNodeStream(tree);
  for await (const c of prelude) chunks.push(c);
  const hydrated = (await renderToString(Buffer.concat(chunks).toString("utf8"), { beforeHydrate: async () => {} })).html;
  const styles = [...hydrated.matchAll(/<style[\s\S]*?<\/style>/g)].map((x) => x[0]).join("\n");
  let body = hydrated.match(/<body[^>]*>([\s\S]*)<\/body>/)?.[1] ?? hydrated;

  for (const [name, id] of Object.entries(emojiIds)) {
    body = body.replaceAll(`https://cdn.discordapp.com/emojis/${id}.png`, `data:image/png;base64,${emojiPng[name]}`);
  }
  body = body.replaceAll("https://cdn.discordapp.com/embed/avatars/0.png", AVATAR);
  // the page script puts the real time in; until then the timestamp says "today" in the language of the shop
  body = body.replace(/(class="discord-message-timestamp"[^>]*>(?:<!--[^>]*-->)?)[^<]+/, (_all, head) => head + TXT.script.today);
  body = body.replace(/ url="data:[^"]*"/g, "");
  return { styles, body };
}

const emojiIds = JSON.parse(readFileSync(new URL("../assets/emoji/ids.json", import.meta.url), "utf8"));
const emojiPng = Object.fromEntries(
  Object.keys(emojiIds).map((n) => [n, readFileSync(new URL(`../assets/emoji/small/${n}.png`, import.meta.url)).toString("base64")]),
);
const AVATAR = "data:image/jpeg;base64," + readFileSync(new URL("../assets/demo/avatar.jpg", import.meta.url)).toString("base64");

async function build(code) {
  const demo = DEMOS[code];
  SHOP = SHOPS[code];
  TXT = landingTexts(SHOP.lang);
  SHOWN_HOST = siteHost(SHOP);

  const products = [];
  for (const p of demo.products) products.push(await loadProduct(p));
  const rendered = [];
  for (const p of products) rendered.push(await renderProduct(p));

  const styles = rendered[0].styles.replace(/@import url\([^)]*\);?/g, "").replace(/@font-face\{[^}]*\}/g, "");

  const fixes =
    "<style>" +
    ".discord-embed-custom-emoji-image{width:1.375rem!important;height:1.375rem!important;vertical-align:bottom}" +
    ".discord-v2-container a{font-weight:inherit}" +
    ".discord-messages,.discord-messages *{font-family:\"gg sans Normal\",system-ui,\"Helvetica Neue\",Helvetica,Arial,sans-serif!important;transition:none!important}" +
    ".discord-messages strong,.discord-messages b,.discord-messages discord-bold,.discord-messages discord-bold *,.discord-messages [style*=\"font-weight: 700\"],.discord-messages [style*=\"font-weight: 700\"] *{font-family:\"gg sans\",system-ui,\"Helvetica Neue\",Helvetica,Arial,sans-serif!important;font-weight:700}" +
    ".discord-messages .discord-author-username,.discord-messages .discord-button,.discord-messages .discord-button *{font-family:\"gg sans SemiBold\",system-ui,\"Helvetica Neue\",Helvetica,Arial,sans-serif!important;font-weight:600}" +
    ".discord-messages{min-height:0!important;padding:0!important;margin:0!important;border:0!important;border-radius:0!important;background:transparent!important}" +
    ".discord-messages .discord-message{padding:0!important;margin:0!important;background:transparent!important}" +
    ".discord-messages .discord-v2-container{margin:0!important;max-width:none!important}" +
    ".discord-messages *{cursor:default!important}" +
    ".discord-messages .discord-section{align-items:flex-start!important}" +
    ".discord-messages .discord-section img[alt=\"Thumbnail\"]{width:auto!important;height:auto!important;max-width:90px!important;max-height:90px!important;object-fit:contain!important}" +
    ".discord-messages .discord-v2-container{background-color:#0a0a0c!important;box-shadow:inset 0 0 0 1px #26262a}" +
    ".discord-messages .discord-separator>div{background-color:#2c2c2f!important}" +
    ".discord-messages .discord-button{background-color:#1b1b1e!important;color:#dcdcdf!important;box-shadow:none}" +
    ".discord-messages a:not(.discord-button){color:#2781e7!important}" +
    ".discord-messages .discord-author-username{color:#dcdcdf!important}" +
    ".discord-messages .discord-message-timestamp{color:#73747d!important}" +
    ".discord-messages{--discord-message-bg:#000!important;color:#d4d5d8}" +
    "@media (prefers-color-scheme:light){" +
    ".discord-messages .discord-v2-container{background-color:#f2f3f5!important;box-shadow:inset 0 0 0 1px #e1e2e6}" +
    ".discord-messages .discord-text-display{color:#313338!important}" +
    ".discord-messages [style*=\"color: #d4d5d8\"]{color:#313338!important}" +
    ".discord-messages [style*=\"color: #dcdcdf\"]{color:#060607!important}" +
    ".discord-messages [style*=\"color: #949ba4\"]{color:#5c5e66!important}" +
    ".discord-messages .discord-separator>div{background-color:#dcdde1!important}" +
    ".discord-messages .discord-button{background-color:#e3e5e8!important;color:#060607!important}" +
    ".discord-messages a:not(.discord-button){color:#006ce7!important}" +
    ".discord-messages .discord-author-username{color:#060607!important}" +
    ".discord-messages .discord-message-timestamp{color:#5c5e66!important}" +
    ".discord-messages{--discord-message-bg:#fff!important;color:#313338}" +
    "}" +
    "</style>";
  const n = products.length;
  const each = (fn) => products.map((_, i) => fn(i)).join(",");
  const tabs =
    "<style>" +
    ".demos{position:relative}" +
    ".demos>input{position:absolute;opacity:0;width:0;height:0;margin:0}" +
    ".picks{display:flex;flex-wrap:wrap;gap:.4rem;justify-content:center;margin:0 0 1rem}" +
    ".picks label{font:500 .82rem var(--sans);padding:.35rem .85rem;border:1px solid var(--line);border-radius:99px;color:var(--muted);cursor:pointer;user-select:none}" +
    ".picks label:hover{color:var(--fg)}" +
    ".panel{display:none}" +
    `${each((i) => `#demo${i}:checked~.picks label[for=demo${i}]`)}{background:var(--head);color:var(--bg);border-color:var(--head)}` +
    `${each((i) => `#demo${i}:focus-visible~.picks label[for=demo${i}]`)}{outline:2px solid var(--a);outline-offset:2px}` +
    products.map((_, i) => `#demo${i}:checked~.panels>.panel:nth-child(${i + 1}){display:block}`).join("") +
    "</style>";
  const html =
    `<div class="demos">` +
    products.map((p, i) => `<input type="radio" name="demo" id="demo${i}"${i === 0 ? " checked" : ""} aria-label="${p.label}">`).join("") +
    `<div class="picks">` + products.map((p, i) => `<label for="demo${i}">${p.label}</label>`).join("") + `</div>` +
    `<div class="panels">` +
    products
      .map(
        (p, i) =>
          `<div class="panel"><div class="demo" role="img" aria-label="${TXT.demoAria(p.label)}">${rendered[i].body}</div>` +
          `</div>`,
      )
      .join("") +
    `</div></div>`;
  writeFileSync(new URL(`../src/${demo.out}`, import.meta.url), `${styles}\n${fixes}\n${tabs}\n${html}\n`);
  console.log(`ok: src/${demo.out} (${((styles.length + html.length) / 1000) | 0} kB), ${SHOP.code}, ${n} produktů: ${products.map((p) => p.id).join(", ")}`);
}

for (const code of WANT === "all" ? Object.keys(DEMOS) : [WANT]) await build(code);
