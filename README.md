# fxalza

Pěkné náhledy odkazů na **Alza.cz** v Discordu: název, cena, sleva, kupóny, cashback a klubové ceny.

Stačí v odkazu přepsat `alza.cz` na `fxalza.cz`:

```
https://www.alza.cz/<produkt>-d12345.htm  →  https://fxalza.cz/<produkt>-d12345.htm
```

Kdo odkaz otevře v prohlížeči, skončí rovnou na Alze.

**Neoficiální nástroj, s Alza.cz nijak nesouvisí.**

## Spuštění

Potřebuješ Node ≥ 23.6 a [`uv`](https://astral.sh/uv).

```bash
node src/server.ts
```

Server poslouchá na `http://127.0.0.1:8484`. Konfiguraci zkopíruj z `.env.example`.

## Nastavení

| Proměnná         | Výchozí             | Význam                                  |
| ---------------- | ------------------- | --------------------------------------- |
| `PORT` / `HOST`  | 8484 / 127.0.0.1    | adresa serveru                          |
| `PUBLIC_URL`     | `https://fxalza.cz` | veřejná adresa                          |
| `IMG_W`          | 600                 | velikost obrázku v náhledu (px)         |
| `CACHE_TTL_MS`   | 6 h                 | jak dlouho se drží data produktu        |
| `BENEFITS`       | 1                   | `0` vypne kupóny a klubové ceny         |

## API

`/<produkt>-d<id>.htm?format=json` vrátí data produktu jako JSON (CORS `*`).

## Poděkování

- [FxEmbed](https://github.com/FxEmbed/FxEmbed) (MIT) – inspirace a rozpoznávání botů
- [Alza-Benefit-Prices](https://github.com/DeRus0/Alza-Benefit-Prices) – inspirace logikou klubových cen
- [discord-html-transcripts-v2](https://github.com/Exodo0/discord-html-transcripts-v2) (Apache-2.0) – ukázka karty na úvodní stránce
