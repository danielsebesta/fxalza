> [!WARNING]
> Neoficiální nástroj, s Alza.cz nijak nesouvisí.

# fxalza

Open source nástroj, který na Discordu ukáže náhled odkazů z Alzy: název, cenu, slevy, kupóny, cashback a klubové ceny. Jinde (Telegram, Slack, Facebook a další) se odkaz také rozbalí, jen jednodušeji, bez barevných ikon a komponent.

Stačí v odkazu přepsat `alza.cz` na `fxalza.cz`:

```
alza.cz/<produkt>-d12345.htm  →  fxalza.cz/<produkt>-d12345.htm
```

Kdo odkaz otevře v prohlížeči, skončí rovnou na Alze.

## Další obchody Alzy

Funguje i Alza.sk, Alza.hu, Alza.de a Alza.at. Místo `alza.sk` napiš `sk.fxalza.cz`, podobně `hu.`, `de.` a `at.`:

```
alza.sk/<produkt>-d12345.htm  →  sk.fxalza.cz/<produkt>-d12345.htm
alza.hu/<produkt>-d12345.htm  →  hu.fxalza.cz/<produkt>-d12345.htm
```

Náhled je ve slovenštině, maďarštině nebo němčině, ceny jsou v eurech (s centy) nebo ve forintech a každý obchod má vlastní cache. Alza.hu a Alza.at nemají ceník ISIC, ten se tam nestahuje. Jde to i cestou, tedy `fxalza.cz/alza.sk/<produkt>-d12345.htm`. Ostatní domény (`alza.pl`, `alza.co.uk`, `alza.ch`) zatím nejsou podporované.

Úvodní stránka i chybové stránky jsou v jazyce obchodu (cs, sk, hu, de). Adresa, na které obchod žije, je jedno místo v nastavení: kdyby měl obchod vlastní doménu, stačí `SHOP_DOMAINS=sk=fxalza.sk,hu=fxalza.hu`. Všude, kde stránka píše vlastní adresu (odkazy, canonical, převodník), se pak použije ta doména a subdoména dál funguje vedle ní.

## Poděkování

- [FxEmbed](https://github.com/FxEmbed/FxEmbed) (MIT) - inspirace a rozpoznávání botů
- [Alza-Benefit-Prices](https://github.com/dexnis-dev/Alza-Benefit-Prices) - inspirace pro celý projekt a jeho logiku, hlavně klubové ceny a kupóny
- [alza-mcp-community](https://github.com/lukabudik/alza-mcp-community) (MCP server pro Alzu) - inspirace v tom, jak s Alzou komunikovat, a nápad s `utm_source`
- [Hlídač shopů](https://www.hlidacshopu.cz) - historie cen na tlačítku v náhledu
