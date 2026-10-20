#!/usr/bin/env node
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import React from "react";
import { prerenderToNodeStream } from "react-dom/static";

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
const SHOWN_HOST = "fxalza.cz";
const UA = "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)";

const PRODUCTS = [
  { id: "13067221", label: "Epson EcoTank L4360" },
  { id: "13450080", label: "Google Pixel 11" },
  { id: "12978903", label: "Acer Predator" },
  { id: "5509713", label: "AlzaPower kabel" },
];
const KIND_LABEL = { sale: "sleva", coupon: "slevový kód", cashback: "cashback", tradein: "výkupní bonus", alzaplus: "AlzaPlus+", promo: "akční cena", tier: "klubové ceny" };
const KIND_ORDER = Object.keys(KIND_LABEL);

async function loadProduct(p) {
  const get = (path, ua) => fetch(BASE + path, { headers: { "user-agent": ua } });
  const [embed, json] = await Promise.all([get("/d" + p.id, UA), get("/d" + p.id + "?format=json", "fxalza-landing-demo")]);
  if (!embed.ok || !json.ok) throw new Error(`/d${p.id} -> ${embed.status}/${json.status} (běží server?)`);
  const m = (await embed.text()).match(/<script id="discord:component-embed" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) throw new Error(`/d${p.id}: v odpovědi není discord:component-embed`);
  const data = await json.json();
  const thumb = "data:image/jpeg;base64," + readFileSync(new URL(`../assets/demo/${p.id}.jpg`, import.meta.url)).toString("base64");
  const slug = new URL(data.canonicalUrl).pathname;
  const kinds = KIND_ORDER.filter((k) => (data.benefits ?? []).some((x) => x.kind === k));
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
          { author: "Uživatel", avatar: "https://cdn.discordapp.com/embed/avatars/0.png", timestamp: "2026-10-18T21:45:00.000Z" },
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
  body = body.replace(/(class="discord-message-timestamp"[^>]*>(?:<!--[^>]*-->)?)[^<]+/, "$1dnes");
  body = body.replace(/ url="data:[^"]*"/g, "");
  return { styles, body };
}

const emojiIds = JSON.parse(readFileSync(new URL("../assets/emoji/ids.json", import.meta.url), "utf8"));
const emojiPng = Object.fromEntries(
  Object.keys(emojiIds).map((n) => [n, readFileSync(new URL(`../assets/emoji/small/${n}.png`, import.meta.url)).toString("base64")]),
);
const AVATAR =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80"><circle cx="40" cy="40" r="40" fill="#5865f2"/>' +
      '<circle cx="40" cy="32" r="12" fill="#fff"/><path d="M16 66c3-14 14-20 24-20s21 6 24 20z" fill="#fff"/></svg>',
  );

const products = [];
for (const p of PRODUCTS) products.push(await loadProduct(p));
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
const fmtDate = new Intl.DateTimeFormat("cs-CZ", { day: "numeric", month: "numeric", year: "numeric" }).format(new Date(products[0].fetchedAt));
const html =
  `<div class="demos">` +
  products.map((p, i) => `<input type="radio" name="demo" id="demo${i}"${i === 0 ? " checked" : ""} aria-label="${p.label}">`).join("") +
  `<div class="picks">` + products.map((p, i) => `<label for="demo${i}">${p.label}</label>`).join("") + `</div>` +
  `<div class="panels">` +
  products
    .map(
      (p, i) =>
        `<div class="panel"><div class="demo" role="img" aria-label="Ukázka: zpráva v Discordu s odkazem na produkt ${p.label} a kartou s cenou a výhodami">${rendered[i].body}</div>` +
        `<figcaption>Ukazuje: ${p.kinds.map((k) => KIND_LABEL[k]).join(", ")} · ceny z ${fmtDate}</figcaption></div>`,
    )
    .join("") +
  `</div></div>`;
writeFileSync(new URL("../src/landing-demo.html", import.meta.url), `${styles}\n${fixes}\n${tabs}\n${html}\n`);
console.log(`ok: src/landing-demo.html (${((styles.length + html.length) / 1000) | 0} kB), ${n} produktů: ${products.map((p) => p.id).join(", ")}`);
