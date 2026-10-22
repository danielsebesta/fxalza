import type { Lang } from "./shops.ts";

// What the landing page says, in the language of the shop whose subdomain it is served on. The strings that contain
// markup are written here, not taken from the user, so they go into the page as they are.
export interface LandingTexts {
  title: string;
  description: string;
  tagline: string;
  intro1: string;
  // `from` is the Alza domain (alza.sk) and `to` the same shop on this site (sk.fxalza.cz)
  intro2: (from: string, to: string) => string;
  demoTitle: string;
  // the description of the demo for a screen reader
  demoAria: (product: string) => string;
  howTitle: string;
  step1: string;
  step2: (from: string, to: string) => string;
  step3: string;
  othersLead: string;
  tryLabel: string;
  openSourceTitle: string;
  openSource: (github: string) => string;
  thanksTitle: string;
  creditFxembed: string;
  creditExtension: string;
  creditMcp: string;
  creditHistory: string;
  madeBy: string;
  // footer of the translated versions; `original` is the link to the Czech site
  machineTranslation: (original: string) => string;
  // the pages a visitor lands on when something is not right
  problems: {
    notProductTitle: string;
    notProductBody: (from: string, to: string) => string;
    rateTitle: string;
    rateBody: string;
    loadTitle: string;
    loadBody: string;
    wrongTitle: string;
    wrongBody: string;
    back: string;
    unsupportedTitle: string;
    unsupportedBody: (tld: string, supported: string) => string;
    goToAlza: string;
  };
  // shown by the converter script
  script: {
    enter: string;
    unsupported: string;
    notProduct: string;
    notLink: string;
    copy: string;
    copied: string;
    // "Today at 21:02" as the Discord of that language writes it: the words before the time and, in German, the one after it
    today: string;
    todaySuffix: string;
  };
}

const cs: LandingTexts = {
  title: "fxalza - náhledy odkazů z Alzy na Discordu",
  description: "Open source nástroj, který na Discordu ukáže náhled odkazů z Alzy: název, cenu, slevy, kupóny, cashback a klubové ceny.",
  tagline: "Náhledy odkazů z Alzy na Discordu",
  intro1: "Pošleš odkaz z Alzy a na Discordu z něj zbyde jen odkaz. Žádná fotka, žádný popisek, žádná cena, nic.",
  intro2: (_from, to) => `Přidej před <code>alza.cz</code> písmena <span class="fx">fx</span> (<code>${to}</code>) a Discord z něj udělá kartu s fotkou, cenou, slevami a kupóny.`,
  demoTitle: "Ukázka náhledu odkazu na Discordu",
  demoAria: (product) => `Ukázka: zpráva na Discordu s odkazem na produkt ${product} a kartou s cenou a výhodami`,
  howTitle: "Jak na to",
  step1: "Otevři produkt na Alze a zkopíruj odkaz.",
  step2: () => `Před <code>alza.cz</code> dopiš <span class="fx">fx</span>. Nic dalšího přepisovat nemusíš, <code>www.</code> i zbytek odkazu klidně zůstanou. Nebo ho nech přepsat v políčku níž.`,
  step3: "Pošli to na Discord. Kdo na odkaz klikne, skončí rovnou na Alze.",
  othersLead: "Funguje i pro další obchody Alzy:",
  tryLabel: "Odkaz z Alzy",
  openSourceTitle: "Neoficiální a open source",
  openSource: (github) => `Kód je pod licencí MIT: ${github}. Nejsme oficiální produkt Alzy a s Alza.cz nijak nesouvisíme. Značka a logo patří jejich vlastníkům. Ceny můžou být zastaralé, rozhoduje vždy web Alzy.`,
  thanksTitle: "Poděkování",
  creditFxembed: "(MIT) - inspirace a rozpoznávání botů",
  creditExtension: "- inspirace pro celý projekt a jeho logiku, hlavně klubové ceny a kupóny",
  creditMcp: "(MCP server pro Alzu) - inspirace v tom, jak s Alzou komunikovat, a nápad s <code>utm_source</code>",
  creditHistory: "- historie cen na tlačítku v náhledu",
  madeBy: "Vytvořil",
  machineTranslation: (original) => `Původní web je ${original}. Tahle verze byla přeložena strojově pomocí AI.`,
  problems: {
    notProductTitle: "Tohle není odkaz na produkt z Alzy",
    notProductBody: (from, to) => `Odkaz na produkt na Alze končí na -d1234567.htm. V takovém odkazu změň ${from} na ${to} a Discord ukáže náhled.`,
    rateTitle: "Moc požadavků najednou",
    rateBody: "Náhled se teď načítá pro hodně odkazů. Zkus to prosím za chvíli.",
    loadTitle: "Náhled se nepodařilo načíst",
    loadBody: "Alza teď neodpovídá nebo je moc požadavků. Zkus to prosím za chvíli.",
    wrongTitle: "Něco se pokazilo",
    wrongBody: "Náhled se teď nepodařilo vytvořit. Zkus to prosím za chvíli.",
    back: "Zpět na fxalza",
    unsupportedTitle: "fxalza tenhle obchod Alzy nepodporuje",
    unsupportedBody: (tld, supported) => `Odkaz na alza.${tld} zatím nejde zobrazit, funguje jen ${supported}.`,
    goToAlza: "Přejít na Alzu",
  },
  script: {
    enter: "Vlož odkaz z Alzy.",
    unsupported: "Tahle Alza zatím nefunguje, jen alza.cz, alza.sk, alza.hu, alza.de a alza.at.",
    notProduct: "Vlož odkaz na konkrétní produkt (končí na -d1234567.htm).",
    notLink: "Tohle nevypadá jako odkaz na Alzu.",
    copy: "Zkopírovat",
    copied: "Zkopírováno",
    today: "dnes v",
    todaySuffix: "",
  },
};

const sk: LandingTexts = {
  title: "fxalza - náhľady odkazov z Alzy na Discorde",
  description: "Open source nástroj, ktorý na Discorde ukáže náhľad odkazov z Alzy: názov, cenu, zľavy, kupóny, cashback a klubové ceny.",
  tagline: "Náhľady odkazov z Alzy na Discorde",
  intro1: "Pošleš odkaz z Alzy a na Discorde z neho ostane len odkaz. Žiadna fotka, žiadny popis, žiadna cena, nič.",
  intro2: (from, to) => `Namiesto <code>${from}</code> napíš <code>${to}</code> a Discord z neho urobí kartu s fotkou, cenou, zľavami a kupónmi.`,
  demoTitle: "Ukážka náhľadu odkazu na Discorde",
  demoAria: (product) => `Ukážka: správa na Discorde s odkazom na produkt ${product} a kartou s cenou a výhodami`,
  howTitle: "Ako na to",
  step1: "Otvor produkt na Alze a skopíruj odkaz.",
  step2: (from, to) => `Zmeň <code>${from}</code> na <code>${to}</code>. Nič ďalšie prepisovať netreba, <code>www.</code> aj zvyšok odkazu pokojne ostanú. Alebo ho nechaj prepísať v políčku nižšie.`,
  step3: "Pošli to na Discord. Kto na odkaz klikne, skončí rovno na Alze.",
  othersLead: "Funguje aj pre ďalšie obchody Alzy:",
  tryLabel: "Odkaz z Alzy",
  openSourceTitle: "Neoficiálne a open source",
  openSource: (github) => `Kód je pod licenciou MIT: ${github}. Nie sme oficiálny produkt Alzy a s Alza.cz nijako nesúvisíme. Značka a logo patria ich vlastníkom. Ceny môžu byť zastarané, rozhoduje vždy web Alzy.`,
  thanksTitle: "Poďakovanie",
  creditFxembed: "(MIT) - inšpirácia a rozpoznávanie botov",
  creditExtension: "- inšpirácia pre celý projekt a jeho logiku, hlavne klubové ceny a kupóny",
  creditMcp: "(MCP server pre Alzu) - inšpirácia v tom, ako s Alzou komunikovať, a nápad s <code>utm_source</code>",
  creditHistory: "- história cien na tlačidle v náhľade",
  madeBy: "Vytvoril",
  machineTranslation: (original) => `Pôvodná stránka je ${original} (po česky). Táto verzia bola preložená strojovo pomocou AI.`,
  problems: {
    notProductTitle: "Toto nie je odkaz na produkt z Alzy",
    notProductBody: (from, to) => `Odkaz na produkt na Alze končí na -d1234567.htm. V takom odkaze zmeň ${from} na ${to} a Discord ukáže náhľad.`,
    rateTitle: "Príliš veľa požiadaviek naraz",
    rateBody: "Náhľad sa teraz načítava pre veľa odkazov. Skús to, prosím, o chvíľu.",
    loadTitle: "Náhľad sa nepodarilo načítať",
    loadBody: "Alza práve neodpovedá alebo je príliš veľa požiadaviek. Skús to, prosím, o chvíľu.",
    wrongTitle: "Niečo sa pokazilo",
    wrongBody: "Náhľad sa teraz nepodarilo vytvoriť. Skús to, prosím, o chvíľu.",
    back: "Späť na fxalza",
    unsupportedTitle: "fxalza tento obchod Alzy nepodporuje",
    unsupportedBody: (tld, supported) => `Odkaz na alza.${tld} zatiaľ nejde zobraziť, funguje len ${supported}.`,
    goToAlza: "Prejsť na Alzu",
  },
  script: {
    enter: "Vlož odkaz z Alzy.",
    unsupported: "Táto Alza zatiaľ nefunguje, len alza.cz, alza.sk, alza.hu, alza.de a alza.at.",
    notProduct: "Vlož odkaz na konkrétny produkt (končí na -d1234567.htm).",
    notLink: "Toto nevyzerá ako odkaz na Alzu.",
    copy: "Skopírovať",
    copied: "Skopírované",
    today: "Dnes o",
    todaySuffix: "",
  },
};

const hu: LandingTexts = {
  title: "fxalza - Alza-linkek előnézete Discordon",
  description: "Nyílt forráskódú eszköz, amely Discordon előnézetet mutat az Alza-linkekről: név, ár, kedvezmények, kuponok, cashback és klubárak.",
  tagline: "Alza-linkek előnézete Discordon",
  intro1: "Ha Alza-linket küldesz, Discordon csak egy sima link marad belőle. Se kép, se leírás, se ár, semmi.",
  intro2: (from, to) => `Az <code>${from}</code> helyett írd azt, hogy <code>${to}</code>, és a Discord kártyát csinál belőle fotóval, árral, kedvezményekkel és kuponokkal.`,
  demoTitle: "Egy Alza-link előnézete Discordon",
  demoAria: (product) => `Példa: Discord-üzenet a(z) ${product} termék linkjével és egy kártyával az árral és a kedvezményekkel`,
  howTitle: "Hogyan működik",
  step1: "Nyisd meg a terméket az Alzán, és másold ki a linkjét.",
  step2: (from, to) => `Az <code>${from}</code> helyett írd azt, hogy <code>${to}</code>. Mást nem kell átírnod, a <code>www.</code> és a link többi része maradhat. Vagy hagyd, hogy az alábbi mező átírja helyetted.`,
  step3: "Küldd el Discordon. Aki rákattint a linkre, rögtön az Alzán köt ki.",
  othersLead: "Az Alza többi áruházával is működik:",
  tryLabel: "Alza-link",
  openSourceTitle: "Nem hivatalos és nyílt forráskódú",
  openSource: (github) => `A kód MIT licenc alatt érhető el: ${github}. Nem vagyunk az Alza hivatalos terméke, és semmi közünk az Alza.cz a.s.-hez. A márka és a logó a tulajdonosaiké. Az árak lehetnek elavultak, mindig az Alza webhelye az irányadó.`,
  thanksTitle: "Köszönet",
  creditFxembed: "(MIT) - ihlet és a botok felismerése",
  creditExtension: "- ihlet az egész projekthez és a logikájához, főleg a klubárakhoz és a kuponokhoz",
  creditMcp: "(MCP-szerver az Alzához) - ihlet ahhoz, hogyan érdemes az Alzával kommunikálni, és az <code>utm_source</code> ötlete",
  creditHistory: "- árelőzmények a gombon az előnézetben",
  madeBy: "Készítette",
  machineTranslation: (original) => `Az eredeti oldal a ${original} (csehül). Ez a verzió gépi fordítással, mesterséges intelligencia segítségével készült.`,
  problems: {
    notProductTitle: "Ez nem egy Alza-termék linkje",
    notProductBody: (from, to) => `Az Alza-termékek linkje -d1234567.htm-re végződik. Egy ilyen linkben írd át az ${from} részt erre: ${to}, és a Discord megmutatja az előnézetet.`,
    rateTitle: "Túl sok kérés egyszerre",
    rateBody: "Az előnézet most sok linkhez töltődik. Próbáld újra egy kis idő múlva.",
    loadTitle: "Az előnézetet nem sikerült betölteni",
    loadBody: "Az Alza most nem válaszol, vagy túl sok a kérés. Próbáld újra egy kis idő múlva.",
    wrongTitle: "Valami elromlott",
    wrongBody: "Az előnézetet most nem sikerült elkészíteni. Próbáld újra egy kis idő múlva.",
    back: "Vissza az fxalza oldalára",
    unsupportedTitle: "Az fxalza nem támogatja ezt az Alza-áruházat",
    unsupportedBody: (tld, supported) => `Az alza.${tld} linkje egyelőre nem jeleníthető meg, csak ezek működnek: ${supported}.`,
    goToAlza: "Tovább az Alzára",
  },
  script: {
    enter: "Illeszd be az Alza-linket.",
    unsupported: "Ez az Alza egyelőre nem működik, csak az alza.cz, alza.sk, alza.hu, alza.de és alza.at.",
    notProduct: "Egy konkrét termék linkjét illeszd be (-d1234567.htm-re végződik).",
    notLink: "Ez nem úgy néz ki, mint egy Alza-link.",
    copy: "Másolás",
    copied: "Másolva",
    today: "Ma ekkor:",
    todaySuffix: "",
  },
};

const de: LandingTexts = {
  title: "fxalza - Link-Vorschauen für Alza auf Discord",
  description: "Ein Open-Source-Tool, das auf Discord eine Vorschau von Alza-Links zeigt: Name, Preis, Rabatte, Gutscheine, Cashback und Clubpreise.",
  tagline: "Link-Vorschauen für Alza auf Discord",
  intro1: "Du schickst einen Alza-Link, und auf Discord bleibt nur der Link übrig. Kein Foto, keine Beschreibung, kein Preis, nichts.",
  intro2: (from, to) => `Schreib statt <code>${from}</code> einfach <code>${to}</code>, und Discord macht daraus eine Karte mit Foto, Preis, Rabatten und Gutscheinen.`,
  demoTitle: "Beispiel für eine Link-Vorschau auf Discord",
  demoAria: (product) => `Beispiel: Discord-Nachricht mit einem Link zum Produkt ${product} und einer Karte mit Preis und Vorteilen`,
  howTitle: "So geht's",
  step1: "Öffne das Produkt bei Alza und kopiere den Link.",
  step2: (from, to) => `Ersetze <code>${from}</code> durch <code>${to}</code>. Mehr musst du nicht ändern, <code>www.</code> und der Rest des Links dürfen bleiben. Oder lass das Feld unten den Link für dich umschreiben.`,
  step3: "Schick den Link auf Discord. Wer darauf klickt, landet direkt bei Alza.",
  othersLead: "Funktioniert auch für die anderen Alza-Shops:",
  tryLabel: "Alza-Link",
  openSourceTitle: "Inoffiziell und Open Source",
  openSource: (github) => `Der Code steht unter der MIT-Lizenz: ${github}. Wir sind kein offizielles Produkt von Alza und haben mit Alza.cz a.s. nichts zu tun. Marke und Logo gehören ihren Inhabern. Preise können veraltet sein, maßgeblich ist immer die Website von Alza.`,
  thanksTitle: "Danksagung",
  creditFxembed: "(MIT) - Inspiration und Erkennung von Bots",
  creditExtension: "- Inspiration für das ganze Projekt und seine Logik, vor allem Clubpreise und Gutscheine",
  creditMcp: "(MCP-Server für Alza) - Inspiration dafür, wie man mit Alza kommuniziert, und die Idee mit <code>utm_source</code>",
  creditHistory: "- Preisverlauf auf der Schaltfläche in der Vorschau",
  madeBy: "Erstellt von",
  machineTranslation: (original) => `Die Originalseite ist ${original} (auf Tschechisch). Diese Version wurde maschinell mit Hilfe von KI übersetzt.`,
  problems: {
    notProductTitle: "Das ist kein Link zu einem Alza-Produkt",
    notProductBody: (from, to) => `Ein Produktlink bei Alza endet auf -d1234567.htm. Ersetze in so einem Link ${from} durch ${to}, dann zeigt Discord die Vorschau.`,
    rateTitle: "Zu viele Anfragen auf einmal",
    rateBody: "Die Vorschau wird gerade für viele Links geladen. Versuch es bitte gleich noch einmal.",
    loadTitle: "Die Vorschau konnte nicht geladen werden",
    loadBody: "Alza antwortet gerade nicht, oder es sind zu viele Anfragen. Versuch es bitte gleich noch einmal.",
    wrongTitle: "Etwas ist schiefgelaufen",
    wrongBody: "Die Vorschau konnte gerade nicht erstellt werden. Versuch es bitte gleich noch einmal.",
    back: "Zurück zu fxalza",
    unsupportedTitle: "fxalza unterstützt diesen Alza-Shop nicht",
    unsupportedBody: (tld, supported) => `Der Link zu alza.${tld} lässt sich noch nicht anzeigen, es funktionieren nur ${supported}.`,
    goToAlza: "Weiter zu Alza",
  },
  script: {
    enter: "Füge einen Alza-Link ein.",
    unsupported: "Dieser Alza-Shop wird noch nicht unterstützt, nur alza.cz, alza.sk, alza.hu, alza.de und alza.at.",
    notProduct: "Füge den Link zu einem bestimmten Produkt ein (endet auf -d1234567.htm).",
    notLink: "Das sieht nicht nach einem Alza-Link aus.",
    copy: "Kopieren",
    copied: "Kopiert",
    today: "Heute um",
    todaySuffix: " Uhr",
  },
};

const LANDING: Record<Lang, LandingTexts> = { cs, sk, hu, de };

export function landingTexts(lang: Lang): LandingTexts {
  return LANDING[lang];
}
