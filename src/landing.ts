import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const GITHUB = "https://github.com/danielsebesta/fxalza";
const AUTHOR = "Daniel Šebesta";
const AUTHOR_URL = "https://Sebesta.dev";
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
  function fit() {
    var b = frame.contentDocument && frame.contentDocument.body;
    if (b) frame.style.height = Math.ceil(b.getBoundingClientRect().height) + "px";
  }
  frame.addEventListener("load", function () {
    fit();
    new ResizeObserver(fit).observe(frame.contentDocument.body);
  });
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

const BASE_CSS = `:root{color-scheme:dark;--bg:#07090d;--glow:radial-gradient(ellipse 60rem 26rem at 50% 0,rgba(15,111,197,.26),transparent 70%);--fg:#e7e7e7;--head:#fff;--muted:#8b8b8b;--line:#222;--a:#7cb7ff;--chip:#141414;--text:"Roboto",ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;--sans:var(--text)}
@media (prefers-color-scheme:light){:root{color-scheme:light;--bg:#fcfcfb;--glow:linear-gradient(transparent,transparent);--fg:#222;--head:#000;--muted:#777;--line:#e4e4e0;--a:#1d62d6;--chip:#f0f0ec}}
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
  "Open source nástroj, který v Discordu ukáže náhled odkazů z Alzy: název, cenu, slevy, kupóny, cashback a klubové ceny.";

export const SITEMAP_XML = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${PUBLIC_URL}/</loc></url>
</urlset>
`;

export const LLMS_TXT = `# fxalza

> ${DESCRIPTION}

Stačí v odkazu na produkt přepsat www.alza.cz na ${new URL(PUBLIC_URL).hostname} a Discord ukáže cenu, slevy, kupóny a klubové ceny.

- [Úvodní stránka](${PUBLIC_URL}/): návod a převodník odkazů
- [Zdrojový kód](${GITHUB}): licence MIT
`;

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
  <title>fxalza - náhledy odkazů z Alzy v Discordu</title>
  <meta name="description" content="${esc(DESCRIPTION)}">
  <meta name="author" content="${AUTHOR}">
  <meta name="application-name" content="fxalza">
  <meta name="robots" content="index, follow, max-image-preview:large">
  <meta name="color-scheme" content="light dark">
  <meta name="theme-color" content="#fcfcfb" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#07090d" media="(prefers-color-scheme: dark)">
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
  <meta property="og:title" content="fxalza - náhledy odkazů z Alzy v Discordu">
  <meta property="og:description" content="${esc(DESCRIPTION)}">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="fxalza - náhledy odkazů z Alzy v Discordu">
  <meta name="twitter:description" content="${esc(DESCRIPTION)}">
  <script type="application/ld+json">${ld}</script>
  <style>
    ${FONT_CSS}
    ${BASE_CSS}
    html{background:var(--glow) no-repeat,var(--bg);min-height:100%}
    body{max-width:36rem;margin:0 auto;padding:4.5rem 1.25rem 3rem;color:var(--fg);font:17px/1.7 var(--text);-webkit-font-smoothing:antialiased}
    header{text-align:center;margin-bottom:2.8rem}
    h1{font-size:clamp(2.6rem,10vw,3.8rem);line-height:1.05;letter-spacing:-.035em;font-weight:700;color:var(--head);margin:0 0 1rem}
    .logo{display:block;width:5rem;height:5rem;margin:0 auto .5rem}
    h1 span{color:#0f6fc5}
    .sub{font-size:1.25rem;line-height:1.45;color:var(--muted);margin:0 auto;max-width:28rem}
    h2{font-size:1.5rem;line-height:1.25;letter-spacing:-.012em;font-weight:700;color:var(--head);margin:3rem 0 .5rem}
    figure{margin:2.2rem -.5rem}
    @media (min-width:46rem){figure{margin-inline:-3rem}}
    .demo-frame{display:block;width:100%;height:34rem;border:0;overflow:hidden}
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
  <h1><span>fx</span>alza</h1>
  <p class="sub">Náhledy odkazů z Alzy v Discordu</p>
</header>

<p>Pošleš odkaz z Alzy a v Discordu zůstane holý text. V odkazu změň <code>www.alza.cz</code> na <code>${h}</code> a Discord ukáže cenu, slevy, kupóny a klubové ceny.</p>

<figure><iframe id="demo" class="demo-frame" src="/demo" title="Ukázka náhledu odkazu v Discordu" loading="lazy" scrolling="no"></iframe></figure>

<h2>Jak na to</h2>
<ol>
  <li>Otevři produkt na Alze a zkopíruj odkaz.</li>
  <li>Nahraď <code>www.alza.cz</code> za <code>${h}</code>, nebo použij políčko níž.</li>
  <li>Pošli to do Discordu. Kdo na odkaz klikne, skončí rovnou na Alze.</li>
</ol>
<div class="try">
  <label for="in">Odkaz z Alzy</label>
  <div class="row">
    <input id="in" type="url" inputmode="url" placeholder="https://www.alza.cz/…-d1234567.htm" autocomplete="off" spellcheck="false">
    <button id="copy" type="button" disabled>Zkopírovat</button>
  </div>
  <p id="out" class="small" aria-live="polite">Vlož odkaz z Alzy.</p>
</div>

<h2>Co se ukáže</h2>
<ul>
  <li>cena, případně původní cena a sleva v procentech</li>
  <li>cena s kódem, cashbackem, výkupním bonusem nebo AlzaPlus+</li>
  <li>klubové ceny Gold, Silver, Bronze, ISIC a B2B, když jsou levnější</li>
  <li>krátký popis produktu a dostupnost</li>
</ul>

<h2>Neoficiální a open source</h2>
<p>Kód je pod licencí MIT: <a href="${GITHUB}" rel="noopener">github.com/danielsebesta/fxalza</a>. Nejsme oficiální produkt Alzy a s Alza.cz nijak nesouvisíme. Značka a logo patří jejich vlastníkům. Ceny můžou být zastaralé, rozhoduje vždy web Alzy.</p>

<h2>Poděkování</h2>
<ul class="credits">
  <li><a href="https://github.com/DeRus0/Alza-Benefit-Prices" rel="noopener">Alza Benefit Prices</a> (Tampermonkey skript od Dexnise): logika klubových ceníků a jejich barvy</li>
  <li><a href="https://github.com/lukabudik/alza-mcp-community" rel="noopener">alza-mcp-community</a> (MCP server pro Alzu): průchod přes Cloudflare a nápad s <code>utm_source</code></li>
  <li><a href="https://github.com/FxEmbed/FxEmbed" rel="noopener">FxEmbed</a>: stejný nápad pro X a Bluesky, seznam botů a drobnosti</li>
  <li><a href="https://github.com/Exodo0/discord-html-transcripts-v2" rel="noopener">discord-html-transcripts-v2</a>: vykreslení ukázky karty</li>
</ul>

<footer>
  <p>Vytvořil <a href="${AUTHOR_URL}" rel="author noopener">${AUTHOR}</a></p>
  <p>${esc(disclaimer)}</p>
</footer>
<script>${SCRIPT}</script>
</body>
</html>`;
}
