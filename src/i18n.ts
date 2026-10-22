import type { Lang } from "./shops.ts";

// Every text the embed of a product is made of. Alza's own promotion names arrive in Czech whatever the shop and are shown as they are.
export interface Texts {
  availability: Record<string, string>;
  unknownAvailability: string;
  refurbished: string;
  damaged: string;
  used: string;
  sale: string;
  couponLabel: (code: string) => string;
  alzaplus: string;
  tradein: string;
  cashback: string;
  promo: string;
  tagCoupon: string;
  tagTradein: string;
  tagCashback: string;
  tagPromo: string;
  price: string;
  partial: string;
  open: string;
  stale: string;
  goTo: string;
  productFromAlza: (id: string) => string;
  missing: string;
  failed: string;
  disclaimer: string;
}

const cs: Texts = {
  availability: {
    InStock: "Skladem",
    OutOfStock: "Není skladem",
    PreOrder: "Předprodej",
    PreSale: "Předprodej",
    BackOrder: "Na objednávku",
    LimitedAvailability: "Poslední kusy",
    InStoreOnly: "Jen na prodejně",
    SoldOut: "Vyprodáno",
    OnlineOnly: "Jen online",
    Discontinued: "Prodej skončil",
  },
  unknownAvailability: "Neznámá dostupnost",
  refurbished: "Repasované",
  damaged: "Poškozené",
  used: "Použité",
  sale: "Sleva",
  couponLabel: (code) => `S kódem ${code}`,
  alzaplus: "S AlzaPlus+",
  tradein: "S výkupním bonusem",
  cashback: "S Cashback",
  promo: "Akční cena",
  tagCoupon: "kód",
  tagTradein: "výkup",
  tagCashback: "cashback",
  tagPromo: "akce",
  price: "Cena",
  partial: "Některé ceny se nestihly načíst. Připiš za odkaz cokoliv (třeba písmeno) a pošli ho znovu.",
  open: "Otevřít na Alze",
  stale: "data mohou být starší",
  goTo: "Přejít na",
  productFromAlza: (id) => `Produkt z Alzy (${id})`,
  missing: "Tenhle produkt na Alze už nenajdeme, odkaz je nejspíš neplatný.",
  failed: "Produkt se nepodařilo načíst, zkus odkaz otevřít přímo na Alze.",
  disclaimer: "Neoficiální nástroj, s Alza.cz a.s. nijak nesouvisí.\n„Alza“ a „Alza.cz“ jsou ochranné známky společnosti Alza.cz a.s.",
};

const sk: Texts = {
  availability: {
    InStock: "Skladom",
    OutOfStock: "Nie je skladom",
    PreOrder: "Predpredaj",
    PreSale: "Predpredaj",
    BackOrder: "Na objednávku",
    LimitedAvailability: "Posledné kusy",
    InStoreOnly: "Len na predajni",
    SoldOut: "Vypredané",
    OnlineOnly: "Len online",
    Discontinued: "Predaj skončil",
  },
  unknownAvailability: "Neznáma dostupnosť",
  refurbished: "Repasované",
  damaged: "Poškodené",
  used: "Použité",
  sale: "Zľava",
  couponLabel: (code) => `S kódom ${code}`,
  alzaplus: "S AlzaPlus+",
  tradein: "S výkupom",
  cashback: "S Cashback",
  promo: "Akčná cena",
  tagCoupon: "kód",
  tagTradein: "výkup",
  tagCashback: "cashback",
  tagPromo: "akcia",
  price: "Cena",
  partial: "Niektoré ceny sa nestihli načítať. Pripíš za odkaz čokoľvek (napríklad písmeno) a pošli ho znova.",
  open: "Otvoriť na Alze",
  stale: "údaje môžu byť staršie",
  goTo: "Prejsť na",
  productFromAlza: (id) => `Produkt z Alzy (${id})`,
  missing: "Tento produkt na Alze už nenájdeme, odkaz je pravdepodobne neplatný.",
  failed: "Produkt sa nepodarilo načítať, skús odkaz otvoriť priamo na Alze.",
  disclaimer: "Neoficiálny nástroj, s Alza.cz a.s. nijako nesúvisí.\n„Alza“ a „Alza.sk“ sú ochranné známky spoločnosti Alza.cz a.s.",
};

const hu: Texts = {
  availability: {
    InStock: "Raktáron",
    OutOfStock: "Nincs raktáron",
    PreOrder: "Előrendelés",
    PreSale: "Előértékesítés",
    BackOrder: "Megrendelésre",
    LimitedAvailability: "Utolsó darabok",
    InStoreOnly: "Csak az üzletben",
    SoldOut: "Elfogyott",
    OnlineOnly: "Csak online",
    Discontinued: "Megszűnt",
  },
  unknownAvailability: "Ismeretlen készlet",
  refurbished: "Felújított",
  damaged: "Sérült",
  used: "Használt",
  sale: "Akció",
  couponLabel: (code) => `${code} kuponkóddal`,
  alzaplus: "AlzaPlus+",
  tradein: "Beszámítással",
  cashback: "Cashback",
  promo: "Akciós ár",
  tagCoupon: "kód",
  tagTradein: "beszámítás",
  tagCashback: "cashback",
  tagPromo: "akció",
  price: "Ár",
  partial: "Néhány ár nem töltődött be időben. Írj a link után bármit (például egy betűt), és küldd el újra.",
  open: "Megnyitás az Alzán",
  stale: "az adatok régebbiek lehetnek",
  goTo: "Tovább az",
  productFromAlza: (id) => `Termék az Alzáról (${id})`,
  missing: "Ezt a terméket az Alzán már nem találjuk, a link valószínűleg érvénytelen.",
  failed: "A terméket nem sikerült betölteni, próbáld meg a linket közvetlenül az Alzán megnyitni.",
  disclaimer: "Nem hivatalos eszköz, az Alza.cz a.s.-hez nincs köze.\nAz „Alza” és az „Alza.hu” az Alza.cz a.s. védjegye.",
};

const de: Texts = {
  availability: {
    InStock: "Auf Lager",
    OutOfStock: "Nicht auf Lager",
    PreOrder: "Vorbestellung",
    PreSale: "Vorverkauf",
    BackOrder: "Auf Bestellung",
    LimitedAvailability: "Letzte Stücke",
    InStoreOnly: "Nur im Geschäft",
    SoldOut: "Ausverkauft",
    OnlineOnly: "Nur online",
    Discontinued: "Verkauf beendet",
  },
  unknownAvailability: "Verfügbarkeit unbekannt",
  refurbished: "Generalüberholt",
  damaged: "Beschädigt",
  used: "Gebraucht",
  sale: "Rabatt",
  couponLabel: (code) => `Mit Code ${code}`,
  alzaplus: "Mit AlzaPlus+",
  tradein: "Mit Inzahlungnahme",
  cashback: "Mit Cashback",
  promo: "Aktionspreis",
  tagCoupon: "Code",
  tagTradein: "Inzahlungnahme",
  tagCashback: "Cashback",
  tagPromo: "Aktion",
  price: "Preis",
  partial: "Einige Preise wurden nicht rechtzeitig geladen. Schreib etwas (zum Beispiel einen Buchstaben) hinter den Link und sende ihn erneut.",
  open: "Bei Alza öffnen",
  stale: "Daten können älter sein",
  goTo: "Weiter zu",
  productFromAlza: (id) => `Produkt von Alza (${id})`,
  missing: "Dieses Produkt finden wir bei Alza nicht mehr, der Link ist wohl ungültig.",
  failed: "Das Produkt konnte nicht geladen werden, öffne den Link direkt bei Alza.",
  disclaimer: "Inoffizielles Werkzeug, steht in keiner Verbindung zu Alza.cz a.s.\n„Alza“ und „Alza.{tld}“ sind Marken der Alza.cz a.s.",
};

const TEXTS: Record<Lang, Texts> = { cs, sk, hu, de };

export function texts(lang: Lang): Texts {
  return TEXTS[lang];
}

