# fxalza

Discord embed fixer pro odkazy na **Alza.cz** (PoC).

Alza je za Cloudflare Bot Management a Discordbotovi (stejně jako všem ne-prohlížečovým
klientům) vrací 403 challenge — odkaz se proto v Discordu neembeduje. fxalza stránku
načte serverem (přes Chrome TLS fingerprint), vytáhne data z JSON-LD a Discordbotovi
pošle minimální HTML s OG tagy. Člověka přesměruje na Alzu.

**Neoficiální nástroj, s Alza.cz nijak nesouvisí.**

## Jak to funguje

```
Discord ──▶ fxalza/<slug>-d<id>.htm
              │
              ├─ bot?  ──▶ cache (data/cache.json, TTL 6 h)
              │             └─ miss ──▶ Python sidecar (curl_cffi, Chrome fingerprint)
              │                          ├─▶ www.alza.cz stránka ──▶ JSON-LD ─┐
              │                          └─▶ webapi detailPriceInfoV3 ×6 ceníků ─┤
              │             ──▶ HTML: OG tagy + Discord Component Embed        │
              │                 (title, cena, benefity/kupóny, obrázek, tlačítko)
              └─ člověk ──▶ 302 na www.alza.cz (s utm_source=fxalza)
```

- **TS server** (`src/server.ts`) — routing, bot detekce, OG HTML, Component Embed, redirect.
- **Python sidecar** (`sidecar/cf-transport.py`) — jediné místo, které umí obejít
  Cloudflare (Chrome TLS/HTTP2 fingerprint přes `curl_cffi`). Spouští se přes `uv`,
  udržuje jeden dlouhý proces a cookie jar.
- **Cache** (`src/cache.ts`) — in-memory + JSON na disku, aby se Alza dotazovala
  minimálně (jeden fetch na produkt za TTL).

## Požadavky

- Node ≥ 23.6 (nativní TypeScript, žádný build) — testováno na Node 26
- `uv` (https://astral.sh/uv) — spouští sidecar s `curl_cffi`
- Volitelně `cloudflared` pro veřejný tunel

## Zdroje dat (fallback řetězec)

`src/fetcher.ts` zkouší zdroje postupně, další jen když předchozí selže (403, 429, 5xx, timeout,
challenge stránka, nebo chybí `uv`). Zdroj s chybou se na 60 s přeskakuje (`FETCH_COOLDOWN_MS`).

1. **sidecar** (`curl_cffi`, zdarma, ~0,2–0,6 s) — Alza dnes pouští jen otisk Chrome 150, starší profily
   (i `curl-impersonate`, `impit`) dostávají 403
2. **Bright Data** Web Unlocker (`BRIGHTDATA_KEY`, `BRIGHTDATA_ZONE`) — 1 kredit, 3–15 s
3. **Scrape.do** (`SCRAPEDO_TOKEN`) — `super`+CZ proxy, 10 kreditů
4. **Firecrawl** (`FIRECRAWL_KEY`) — 1 kredit, 1–9 s

Jeden produkt = 7 požadavků (HTML + 6 cenových API), bez sidecaru tedy ~7 kreditů. Malá JSON API
se proto berou přednostně přes Firecrawl (Bright Data na ně odpovídá i přes 15 s). Klíče jsou
volitelné, bez nich se zdroj přeskočí. `SIDECAR_DISABLED=1` vypne Python úplně (host bez `uv`).

## Spuštění

```bash
node src/server.ts          # http://127.0.0.1:8484
```

Veřejně (Cloudflare quick tunnel):

```bash
cloudflared tunnel --url http://127.0.0.1:8484
```

Vlož do Discordu: `https://<tunnel>.trycloudflare.com/<slug>-d<id>.htm`

## Discord Component Embeds

Discord od října 2026 umí **Component Embeds** ([docs](https://docs.discord.com/developers/link-previews/component-embeds)):
do HTML stránky se vloží `<script id="discord:component-embed" type="application/json">`
s Components V2 Containerem a Discord místo obyčejného OG náhledu vykreslí vlastní layout
(sekce s titulkem a thumbnail, texty, separátory, link tlačítka). fxalza to používá:

- **Tělo**: název jako `###` heading odkaz + `(Skladem)` (`#` jako h1 dělá velkou horní mezeru, h3 je těsnější), krátký popis z JSON-LD, prázdný řádek a ceník jako odrážky (`Cena` / `Sleva původní → cena`, kupóny, cashback, ceníky Gold–B2B), vše tučně a s kulatými emoji; accessory = obrázek produktu.
- **Bez patičky**: výrobce, hodnocení ani „Neoficiální náhled“ se nepíšou (byl to balast); dostupnost je v závorce za názvem produktu.
- **Tlačítko** „Otevřít na Alze" s `utm_source=fxalza` (title odkaz vede na kanonickou URL bez utm).
- **Emoji**: Text Display používá Discord markdown, takže fungují unicode i **custom emoji** `<:Název:id>` (animované `<a:…>`); tlačítko má vlastní `emoji` pole (partial emoji: `name`, `id`, `animated`). Ověřeno naživo (SmirkHat v patičce i na tlačítku).
- OG tagy zůstávají jako fallback pro klienty/verze bez podpory; payload se automaticky
  zkracuje pod limit 3 000 B (nejdřív méně důležité řádky benefitů, pak thumbnail).

Náhled a diagnostiku (validaci komponent) dělá oficiální
[Embed Debugger](https://discord.com/developers/embeds) — stačí do něj vložit URL.
Discord si náhledy cachuje ~30 min; změny vynutíš parametrem `?v=2`.

## Benefity a kupóny

Kromě stránky s JSON-LD se pro každý produkt dotazujeme API `webapi.alza.cz` na ceníky
(Gold, Silver, ISIC, Bronze, B2B, Basic) přes `detailPriceInfoV3?pgrik=…`. Řádky v embedu
jdou v pořadí **benefit → Gold → Silver/ISIC → Bronze/B2B**:

- **benefity defaultního ceníku** (kupóny `priceType 3`, AlzaPlus+ cena, cashback, výkupní
  bonus) — co zaplatí běžný zákazník, např. „🎟️ S kódem ALZADNY15 8 990 Kč (−15 %)“,
- **klubové ceny** — cena ceníku, a když ji promo sníží, tak „ceník → cena s promem“ se
  značkou, např. „🏅 Gold 10 433 Kč → 8 868 Kč (−16,1 %) · kód“ (promo se aplikuje na
  klubovou cenu, ne na tu původní); rovné ceníky se spojují (Silver/ISIC, Bronze/B2B).

Základem je vždy cena z hlavičky (Basic); benefity ji jen doplňují. Logika výběru ceny
(skrývání ceníků bez vlastní ceny, párování Silver/ISIC a Bronze/B2B, priorita hlavní ceny
při shodě) je přepsaná z userscriptu
[Alza-Benefit-Prices](https://github.com/DeRus0/Alza-Benefit-Prices) od Dexnise —
userscript nemá licenční soubor, kód nebyl kopírován, jen inspirace logikou API.

Benefity se tahají paralelně se stránkou a nikdy nesmí shodit embed: při chybě/timeoutu
(max ~9 s) se prostě vynechají. Vypnout se dají přes `BENEFITS=0`.

## Testy bez Discordu

```bash
# bot (Discord) pohled:
curl -A "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)" http://127.0.0.1:8484/d12924075

# člověk (redirect):
curl -I http://127.0.0.1:8484/d12924075

# náhled HTML i pro člověka:
http://127.0.0.1:8484/d12924075?debug=1

# strojová data (JSON API):
curl "http://127.0.0.1:8484/d12924075?format=json"

# exotický embedder (Discord umí poslat i tohle UA):
curl -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 11.6; rv:92.0) Gecko/20100101 Firefox/92.0" http://127.0.0.1:8484/d12924075
```

## Proměnné prostředí

| Proměnná          | Default  | Význam                                        |
| ----------------- | -------- | --------------------------------------------- |
| `PORT` / `HOST`   | 8484 / 127.0.0.1 | naslouchání                            |
| `IMG_W`           | 600      | velikost obrázku v embedu (px)                |
| `CACHE_TTL_MS`    | 6 h      | jak dlouho se drží data produktu              |
| `CF_SIDECAR_CMD`  | `uv run --with curl_cffi python -u sidecar/cf-transport.py` | override spouštěče sidecaru |
| `ALZA_PROXY_URL`  | –        | HTTP(S)/SOCKS5 proxy pro fetche (rezidenční proxy, když je VPS blokovaná) |
| `BENEFITS`        | 1        | `0` vypne dotazy na ceníky (žádné kupóny/benefity v embedu) |
| `PUBLIC_URL`      | `https://fxalza.cz` | veřejná adresa (canonical, og:url, JSON-LD úvodní stránky) |

## Úvodní stránka a ukázka karty

`/` servíruje `src/landing.ts` (návod, převodník odkazů, open source, disclaimer, poděkování). Ukázka Discord karty je statický fragment
`src/landing-demo.html` vygenerovaný z **reálného payloadu** přes renderery z [discord-html-transcripts-v2](https://github.com/Exodo0/discord-html-transcripts-v2)
(Apache-2.0, jen devDependency), takže vypadá jako skutečný Discord. Po změně vzhledu karty ho přegeneruj (server musí běžet):

```
npm run landing-demo   # DEMO_BASE=http://127.0.0.1:8484
```

Ukázka přepíná pět reálných produktů (`PRODUCTS` v `scripts/make-landing-demo.mjs`), vybraných tak, aby dohromady ukázaly slevu, kód,
cashback, výkup, AlzaPlus+ a klubové ceny. Foto každého je v `assets/demo/<id>.jpg` (z `image.alza.cz/products/…?width=240&height=240`)
a vkládá se do fragmentu jako data URI, miniatura je vpravo nahoře jako v Discordu. Přepínání je čisté CSS, ceny jsou snímek k datu
uvedenému pod ukázkou. Fotky patří Alze, proto je zvaž před publikováním repa. Fragment sám nic externího nenačítá (emoji a avatar jsou
data URI), písmo gg sans přidává úvodní stránka z `fonts.cdnfonts.com`.

## Inspirace: FxEmbed

Řada detailů je převzatá z [FxEmbed](https://github.com/FxEmbed/FxEmbed) (MIT), který řeší totéž pro X/Twitter/Bluesky:

- **Bot UA regex** (`src/server.ts`) — širší záběr včetně exotických reálných UA (Discord občas posílá `Firefox/92`, matrix preview boti, feed readery…).
- **`<meta http-equiv="refresh">`** v embed HTML — když se do bot větve dostane člověk, přesměruje se sám na Alzu (embed crawlery ho ignorují, čtou jen OG tagy).
- **Chyby pro embed klienty jako HTTP 200** s minimálním embedem — zpráva se v Discordu aspoň vykreslí.
- **`Vary: Accept-Encoding, User-Agent`** na odpovědích, které se liší podle UA.
- **`?format=json`** — strojová odpověď s CORS `*` (obdoba FxEmbed API realmu).

Rozdíl v architektuře: FxEmbed běží jako Cloudflare Worker (Hono) a upstream (X API) tahá s rotujícím poolem účtů/proxy. Náš upstream (Alza) blokuje podle TLS fingerprintu a rozsahů datacenter IP — Workers jsou pro fetch nepoužitelné (CF ASN + žádný Chrome fingerprint), proto VPS + Python sidecar s curl_cffi.

## Poznámky

- `utm_source=fxalza&utm_medium=discord` se přidává jen do redirectu pro lidi
  (inspirováno domluvou Alzy s projektem alza-mcp-community), boti dostávají čisté
  kanonické `og:url`.
- `robots.txt` povoluje jen `/` (úvodní stránku), produktové cesty a JSON mají `X-Robots-Tag: noindex, nofollow`.
- **Hlavičky**: všude `nosniff`, `Referrer-Policy`, `Permissions-Policy`, COOP. Úvodní stránka má přísné CSP (jediný skript je hashovaný, jediný externí zdroj je `fonts.cdnfonts.com` kvůli písmu gg sans v ukázce Discordu), `X-Frame-Options: DENY`, ETag + `304`, brotli/gzip a `Cache-Control: public, max-age=600, stale-while-revalidate`. Produktové odpovědi zůstávají `no-store` (liší se podle User-Agenta). `?format=json` má CORS `*`, `OPTIONS` preflight a krátký cache (60 s).
- Při selhání fetche se poslouží stale cache, případně minimální embed z slugu URL.
- **Search-bot UA nefungují** (Googlebot/Bingbot/YandexBot → CF je ověřuje přes rDNS na googlebot.com apod., fake z cizí IP = 403 challenge). Kuriozita: `DuckDuckBot/1.1` UA s Chrome TLS projde (Alza ho evidentně pouští), bez Chrome fingerprintu ale ne — ber jako záložní poznatek, ne primární cestu (spoofing cizího crawlera je šedivější a timeoutovaně nestabilní).

## Další kroky (mimo PoC)

- Deploy na VPS (Contabo) + probe, jestli tam projde `curl_cffi` (datacentra bývají
  blokovaná) → případně `ALZA_PROXY_URL` (rezidenční proxy) nebo Browserbase.
- Vlastní doména (např. `fxalza.sebesta.dev` → `fxalza.cz`), persistentní cache (SQLite),
  sledování ceny v čase, image proxy (kdyby Alza zablokovala hotlink pro Discord).

## Vlastní emoji (kulaté ikony Alzy)

`scripts/make-emoji.py` vygeneruje 128×128 PNG do `assets/emoji/` — ceníky Gold/Silver/Bronze/ISIC/B2B v barvách
z userscriptu [Alza-Benefit-Prices](https://github.com/DeRus0/Alza-Benefit-Prices), kupón (originální SVG Alzy),
AlzaPlus+, cashback, výkup, akce a logo Alzy do patičky a na tlačítko.

```
uv run --with resvg-py --with pillow python scripts/make-emoji.py
DISCORD_BOT_TOKEN=... DISCORD_APP_ID=... node scripts/upload-emoji.mjs
```

Upload je jako *application emoji* a zapíše `assets/emoji/ids.json` (commitnout). Bez něj server padá zpět na unicode.
Alternativa bez bota: nahrát PNG ručně na server a doplnit `name → id` do `ids.json`.
