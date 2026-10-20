import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const GITHUB = "https://github.com/danielsebesta/fxalza";
const AUTHOR = "Daniel Šebesta";
const AUTHOR_URL = "https://sebesta.dev";
export const PUBLIC_URL = (process.env.PUBLIC_URL ?? "https://fxalza.cz").replace(/\/$/, "");

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function read(rel: string, enc: BufferEncoding = "utf8"): string {
  try {
    return readFileSync(new URL(rel, import.meta.url)).toString(enc);
  } catch {
    return "";
  }
}

const DEMO = read("./landing-demo.html");

export const FAVICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-4 -4 136 136" shape-rendering="crispEdges"><g fill="#0f6fc5"><path d="M97.46 64.08V37.3H84.04V23.9H70.65v13.4H57.26V23.9H43.87v13.4H30.48v26.78H17.09v13.39h13.39v13.4h13.39v13.38h13.39V90.87h13.39v13.38h13.39V90.87h13.42v-13.4h13.37V64.08H97.46zm-40.21 0H43.86V50.69h13.39v13.39zm26.78 0H70.64V50.69h13.39v13.39z"/><path d="M30.47 104.24h13.39v13.39H30.47z"/><path d="M84.04 104.24h13.39v13.39H84.04z"/><path d="M30.48 10.51h13.39V23.9H30.48z"/><path d="M84.04 10.51h13.39V23.9H84.04z"/><path d="M110.82 37.29h13.4v26.8h-13.4z"/><path d="M3.7 37.28h13.4v26.8H3.7z"/></g></svg>';

const SCRIPT = `(function () {
  var input = document.getElementById("in"), out = document.getElementById("out"), copy = document.getElementById("copy");
  var link = "";
  function msg(text) { out.className = "small"; out.textContent = text; copy.disabled = true; }
  function render() {
    link = "";
    var v = input.value.trim();
    if (!v) return msg("Vlož odkaz z Alzy.");
    try {
      var u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(v) ? v : "https://" + v);
      if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("scheme");
      if (/(^|\\.)alza\\.(sk|de|at|ch|hu|pl|co\\.uk)$/i.test(u.hostname)) return msg("Funguje jen pro Alza.cz.");
      if (!/(^|\\.)alza\\.cz$/i.test(u.hostname)) throw new Error("host");
      if (!/-d\\d+\\.htm$/i.test(u.pathname)) return msg("Vlož odkaz na konkrétní produkt (končí na -d1234567.htm).");
      link = location.origin + u.pathname;
      out.className = ""; out.textContent = "";
      var c = document.createElement("code"); c.textContent = link; out.appendChild(c);
      copy.disabled = false;
    } catch (e) { msg("Tohle nevypadá jako odkaz na alza.cz."); }
  }
  var frame = document.getElementById("demo");
  var wrap = document.getElementById("demo-wrap");
  var DESIGN_WIDTH = 640;
  function fit() {
    var b = frame.contentDocument && frame.contentDocument.body;
    if (!b) return;
    var scale = Math.min(1, wrap.clientWidth / DESIGN_WIDTH);
    frame.style.width = scale < 1 ? DESIGN_WIDTH + "px" : "100%";
    frame.style.transform = scale < 1 ? "scale(" + scale + ")" : "";
    var h = Math.ceil(b.getBoundingClientRect().height);
    frame.style.height = h + "px";
    wrap.style.height = Math.ceil(h * scale) + "px";
  }
  function stamp() {
    var now = new Date();
    var text = "dnes v " + ("0" + now.getHours()).slice(-2) + ":" + ("0" + now.getMinutes()).slice(-2);
    frame.contentDocument.querySelectorAll(".discord-message-timestamp").forEach(function (el) { el.textContent = text; });
  }
  frame.addEventListener("load", function () {
    stamp();
    fit();
    new ResizeObserver(fit).observe(frame.contentDocument.body);
  });
  window.addEventListener("resize", fit);
  input.addEventListener("input", render);
  copy.addEventListener("click", function () {
    if (!link) return;
    navigator.clipboard.writeText(link).then(function () {
      copy.textContent = "Zkopírováno"; setTimeout(function () { copy.textContent = "Zkopírovat"; }, 1500);
    });
  });
})();`;

const SCRIPT_HASH = createHash("sha256").update(SCRIPT).digest("base64");
export const LANDING_CSP = [
  "default-src 'none'",
  `script-src 'sha256-${SCRIPT_HASH}'`,
  "style-src 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data:",
  "frame-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

const FONT_CSS = `@font-face{font-family:"Roboto";font-style:normal;font-weight:100 900;font-display:swap;src:url(/fonts/roboto-latin-ext.woff2) format("woff2");unicode-range:U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF}
@font-face{font-family:"Roboto";font-style:normal;font-weight:100 900;font-display:swap;src:url(/fonts/roboto-latin.woff2) format("woff2");unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}`;

function blob(size: string, at: string, rgb: string, alpha: number): string {
  const stops = Array.from({ length: 11 }, (_, i) => {
    const t = i / 10;
    return `rgba(${rgb},${(alpha * Math.exp(-4.2 * t * t)).toFixed(3)}) ${i * 10}%`;
  });
  return `radial-gradient(${size} at ${at},${stops.join(",")})`;
}

const MESH_GRADIENT = [
  blob("36% 40%", "16% 12%", "15,111,197", 0.78),
  blob("32% 36%", "84% 8%", "32,92,214", 0.6),
  blob("28% 24%", "50% 2%", "56,140,255", 0.4),
  blob("34% 32%", "76% 58%", "10,74,150", 0.5),
  blob("32% 36%", "8% 74%", "15,111,197", 0.46),
  blob("28% 32%", "92% 94%", "26,86,190", 0.42),
].join(",");

const MESH_CSS = `html{background:var(--bg);min-height:100%}
html::before{content:"";position:fixed;inset:-25%;z-index:-1;pointer-events:none;background:${MESH_GRADIENT};opacity:.14;animation:mesh 32s ease-in-out infinite alternate}
html::after{content:"";position:fixed;inset:0;z-index:-1;pointer-events:none;opacity:.04;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")}
@keyframes mesh{from{transform:translate3d(-2%,-1%,0) scale(1)}to{transform:translate3d(2%,2%,0) scale(1.1)}}
@media (prefers-color-scheme:light){html::before{opacity:.09}}
@media (prefers-reduced-motion:reduce){html::before{animation:none}}`;

const BASE_CSS = `:root{color-scheme:dark;--bg:#07090d;--fg:#e7e7e7;--head:#fff;--muted:#8b8b8b;--line:#222;--a:#7cb7ff;--chip:#141414;--text:"Roboto",ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;--sans:var(--text)}
@media (prefers-color-scheme:light){:root{color-scheme:light;--bg:#fcfcfb;--fg:#222;--head:#000;--muted:#777;--line:#e4e4e0;--a:#1d62d6;--chip:#f0f0ec}}
*{box-sizing:border-box}
a{color:var(--a);text-underline-offset:3px}
p,ul,ol{margin:1rem 0}
li{margin:.35rem 0}
code{font:.8em ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:var(--chip);padding:.15em .4em;border-radius:5px;overflow-wrap:anywhere}`;

const DEMO_CSS = `.demo{background:#000;border:1px solid #1a1a1d;padding:16px;border-radius:12px;overflow:hidden;pointer-events:none;user-select:none;color:#d4d5d8}
.demo code{background:#141417;color:#d4d5d8;padding:.1em .3em;border-radius:4px;font-size:.85em}
figcaption{font:.82rem var(--sans);color:var(--muted);text-align:center;margin-top:.8rem}
@media (max-width:36rem){.demo{padding:10px;border-radius:10px}}`;

export const DEMO_CSP = [
  "default-src 'none'",
  "style-src 'unsafe-inline' https://fonts.cdnfonts.com",
  "font-src 'self' https://fonts.cdnfonts.com",
  "img-src 'self' data:",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'self'",
].join("; ");

export const DEMO_HTML = `<!DOCTYPE html>
<html lang="cs">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="robots" content="noindex">
<title>Ukázka náhledu</title>
<link href="https://fonts.cdnfonts.com/css/gg-sans-2" rel="stylesheet">
<style>
${FONT_CSS}
${BASE_CSS}
body{display:flow-root;margin:0;background:transparent;color:var(--fg);font:17px/1.7 var(--text);-webkit-font-smoothing:antialiased}
${DEMO_CSS}
</style>
</head>
<body>${DEMO}</body>
</html>
`;

const DESCRIPTION =
  "Open source nástroj, který na Discordu ukáže náhled odkazů z Alzy: název, cenu, slevy, kupóny, cashback a klubové ceny.";

export const SITEMAP_XML = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${PUBLIC_URL}/</loc></url>
</urlset>
`;

export const LLMS_TXT = `# fxalza

> ${DESCRIPTION}

Stačí v odkazu na produkt přepsat alza.cz na ${new URL(PUBLIC_URL).hostname} a Discord ukáže cenu, slevy, kupóny a klubové ceny.

- [Úvodní stránka](${PUBLIC_URL}/): návod a převodník odkazů
- [Zdrojový kód](${GITHUB}): licence MIT
`;

export function problemHtml(title: string, message: string): string {
  return `<!DOCTYPE html>
<html lang="cs">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} | fxalza</title>
<meta name="description" content="${esc(message)}">
<meta name="robots" content="noindex">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#e5484d">
<meta property="og:type" content="website">
<meta property="og:site_name" content="fxalza">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(message)}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(message)}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style>
${FONT_CSS}
${BASE_CSS}
${MESH_CSS}
body{max-width:34rem;margin:0 auto;padding:6rem 1.25rem 3rem;color:var(--fg);font:17px/1.7 var(--text);text-align:center;-webkit-font-smoothing:antialiased}
.logo{display:block;width:4rem;height:4rem;margin:0 auto 1rem}
h1{font-size:1.8rem;line-height:1.25;letter-spacing:-.02em;color:var(--head);margin:0 0 .8rem}
</style>
</head>
<body>
<img class="logo" src="/favicon.svg" width="64" height="64" alt="">
<h1>${esc(title)}</h1>
<p>${esc(message)}</p>
<p><a href="/">Zpět na fxalza</a></p>
</body>
</html>
`;
}

export function landingHtml(host: string, disclaimer: string): string {
  const h = esc(host);
  const ld = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "fxalza",
    url: PUBLIC_URL + "/",
    description: DESCRIPTION,
    applicationCategory: "UtilitiesApplication",
    operatingSystem: "Web",
    inLanguage: "cs",
    isAccessibleForFree: true,
    license: "https://opensource.org/license/mit",
    codeRepository: GITHUB,
    offers: { "@type": "Offer", price: "0", priceCurrency: "CZK" },
    author: { "@type": "Person", name: AUTHOR, url: AUTHOR_URL },
  }).replace(/</g, "\\u003c");

  return `<!DOCTYPE html>
<html lang="cs">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>fxalza - náhledy odkazů z Alzy na Discordu</title>
  <meta name="description" content="${esc(DESCRIPTION)}">
  <meta name="author" content="${AUTHOR}">
  <meta name="application-name" content="fxalza">
  <meta name="robots" content="index, follow, max-image-preview:large">
  <meta name="color-scheme" content="light dark">
  <meta name="theme-color" content="#0f6fc5">
  <meta name="referrer" content="strict-origin-when-cross-origin">
  <meta name="format-detection" content="telephone=no">
  <link rel="canonical" href="${PUBLIC_URL}/">
  <link rel="preload" href="/fonts/roboto-latin.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="author" href="${AUTHOR_URL}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="fxalza">
  <meta property="og:locale" content="cs_CZ">
  <meta property="og:url" content="${PUBLIC_URL}/">
  <meta property="og:title" content="fxalza - náhledy odkazů z Alzy na Discordu">
  <meta property="og:description" content="${esc(DESCRIPTION)}">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="fxalza - náhledy odkazů z Alzy na Discordu">
  <meta name="twitter:description" content="${esc(DESCRIPTION)}">
  <script type="application/ld+json">${ld}</script>
  <style>
    ${FONT_CSS}
    ${BASE_CSS}
    ${MESH_CSS}
    body{max-width:36rem;margin:0 auto;padding:4.5rem 1.25rem 3rem;color:var(--fg);font:17px/1.7 var(--text);-webkit-font-smoothing:antialiased}
    header{text-align:center;margin-bottom:2.8rem}
    h1{font-size:clamp(2.6rem,10vw,3.8rem);line-height:1.05;letter-spacing:-.035em;font-weight:700;color:var(--head);margin:0 0 1rem}
    .logo{display:block;width:5rem;height:5rem;margin:0 auto .5rem}
    .fx{color:#0f6fc5;font-weight:700}
    h1 .tld{color:#4b515b}
    @media (prefers-color-scheme:light){h1 .tld{color:#b4b8be}}
    .sub{font-size:1.25rem;line-height:1.45;color:var(--muted);margin:0 auto;max-width:28rem}
    h2{font-size:1.5rem;line-height:1.25;letter-spacing:-.012em;font-weight:700;color:var(--head);margin:3rem 0 .5rem}
    figure{margin:2.2rem -.5rem}
    @media (min-width:46rem){figure{margin-inline:-3rem}}
    .demo-wrap{position:relative;overflow:hidden}
    .demo-frame{display:block;width:100%;height:34rem;border:0;overflow:hidden;transform-origin:0 0}
    .small{font:.82rem var(--sans);color:var(--muted)}
    .try{margin:1.6rem 0;padding:1rem 0;border-block:1px solid var(--line)}
    .try label{display:block;font:500 .85rem var(--sans);margin-bottom:.5rem}
    .row{display:flex;gap:.5rem;flex-wrap:wrap}
    input{font:15px var(--sans);flex:1 1 14rem;min-width:0;height:2.5rem;padding:0 .8rem;color:var(--fg);background:transparent;border:1px solid #333;border-radius:8px;outline:0}
    input::placeholder{color:var(--muted)}
    input:focus-visible{border-color:var(--a)}
    button{font:500 15px var(--sans);height:2.5rem;padding:0 1rem;color:var(--bg);background:var(--head);border:0;border-radius:8px;cursor:pointer}
    button:hover:not(:disabled){opacity:.88}
    button:disabled{opacity:.35;cursor:not-allowed}
    button:focus-visible{outline:2px solid var(--a);outline-offset:2px}
    #out{margin:.6rem 0 0;min-height:1.3rem}
    #out code{display:block;padding:.4rem .7rem}
    .credits{font-size:.95rem;color:var(--muted)}
    footer{margin-top:3.5rem;padding-top:1.2rem;border-top:1px solid var(--line);text-align:center;font:.82rem var(--sans);color:var(--muted)}
    footer p{margin:.3rem 0}
    @media (max-width:36rem){body{font-size:17px;padding-top:3rem}figure{margin-inline:-.9rem}}
  </style>
</head>
<body>
<header>
  <img class="logo" src="/favicon.svg" width="80" height="80" alt="">
  <h1><span class="fx">fx</span>alza<span class="tld">.cz</span></h1>
  <p class="sub">Náhledy odkazů z Alzy na Discordu</p>
</header>

<p>Pošleš odkaz z Alzy a na Discordu z něj zbyde jen odkaz. Žádná fotka, žádný popisek, žádná cena, nic.</p>
<p>Přidej před <code>alza.cz</code> písmena <span class="fx">fx</span> (<code>${h}</code>) a Discord z něj udělá kartu s fotkou, cenou, slevami a kupóny.</p>

<figure><div id="demo-wrap" class="demo-wrap"><iframe id="demo" class="demo-frame" src="/demo" title="Ukázka náhledu odkazu na Discordu" loading="lazy" scrolling="no"></iframe></div></figure>

<h2>Jak na to</h2>
<ol>
  <li>Otevři produkt na Alze a zkopíruj odkaz.</li>
  <li>Před <code>alza.cz</code> dopiš <span class="fx">fx</span>. Nic dalšího přepisovat nemusíš, <code>www.</code> i zbytek odkazu klidně zůstanou. Nebo ho nech přepsat v políčku níž.</li>
  <li>Pošli to na Discord. Kdo na odkaz klikne, skončí rovnou na Alze.</li>
</ol>
<div class="try">
  <label for="in">Odkaz z Alzy</label>
  <div class="row">
    <input id="in" type="url" inputmode="url" placeholder="alza.cz/…-d1234567.htm" autocomplete="off" spellcheck="false">
    <button id="copy" type="button" disabled>Zkopírovat</button>
  </div>
  <p id="out" class="small" aria-live="polite">Vlož odkaz z Alzy.</p>
</div>

<h2>Neoficiální a open source</h2>
<p>Kód je pod licencí MIT: <a href="${GITHUB}" rel="noopener">github.com/danielsebesta/fxalza</a>. Nejsme oficiální produkt Alzy a s Alza.cz nijak nesouvisíme. Značka a logo patří jejich vlastníkům. Ceny můžou být zastaralé, rozhoduje vždy web Alzy.</p>

<h2>Poděkování</h2>
<ul class="credits">
  <li><a href="https://github.com/FxEmbed/FxEmbed" rel="noopener">FxEmbed</a> (MIT) - inspirace a rozpoznávání botů</li>
  <li><a href="https://github.com/dexnis-dev/Alza-Benefit-Prices" rel="noopener">Alza-Benefit-Prices</a> - inspirace pro celý projekt a jeho logiku, hlavně klubové ceny a kupóny</li>
  <li><a href="https://github.com/lukabudik/alza-mcp-community" rel="noopener">alza-mcp-community</a> (MCP server pro Alzu) - inspirace v tom, jak s Alzou komunikovat, a nápad s <code>utm_source</code></li>
  <li><a href="https://www.hlidacshopu.cz" rel="noopener">Hlídač shopů</a> - historie cen na tlačítku v náhledu</li>
</ul>

<footer>
  <p>Vytvořil <a href="${AUTHOR_URL}" rel="author noopener">${AUTHOR}</a></p>
  <p>${esc(disclaimer)}</p>
</footer>
<script>${SCRIPT}</script>
</body>
</html>`;
}
