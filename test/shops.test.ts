import assert from "node:assert/strict";
import { test } from "node:test";
import { buildBenefits, conditionText, tiersFor, type PriceCandidate, type TierResult } from "../src/alza.ts";
import { texts } from "../src/i18n.ts";
import { ALL_SHOPS, CZ, SHOPS, formatMoney, parseSiteDomains, shopByTld, shopOfHost, siteHost, siteUrl } from "../src/shops.ts";

test("a shop is recognised by its subdomain of the apex, and the apex is the Czech shop", () => {
  assert.equal(shopOfHost("sk.fxalza.cz", "fxalza.cz"), SHOPS.sk);
  assert.equal(shopOfHost("hu.fxalza.cz", "fxalza.cz"), SHOPS.hu);
  assert.equal(shopOfHost("de.fxalza.cz", "fxalza.cz"), SHOPS.de);
  assert.equal(shopOfHost("at.fxalza.cz", "fxalza.cz"), SHOPS.at);
  assert.equal(shopOfHost("cz.fxalza.cz", "fxalza.cz"), SHOPS.cz);
  assert.equal(shopOfHost("fxalza.cz", "fxalza.cz"), SHOPS.cz);
  // people turn www.alza.sk into www.sk.fxalza.cz
  assert.equal(shopOfHost("www.sk.fxalza.cz", "fxalza.cz"), SHOPS.sk);
  assert.equal(shopOfHost("www.de.fxalza.cz", "fxalza.cz"), SHOPS.de);
  for (const host of ["www.fxalza.cz", "m.fxalza.cz", "pl.fxalza.cz", "a.sk.fxalza.cz", "www.pl.fxalza.cz", "www.www.sk.fxalza.cz", "www.sk.example.com", "sk.example.com", "xsk.fxalza.cz", "sk.fxalza.cz.evil.com"]) {
    assert.equal(shopOfHost(host, "fxalza.cz"), null, host);
  }
});

test("a shop with a domain of its own is served there and on its subdomain, and writes its own address", () => {
  const domains = parseSiteDomains("sk=fxalza.sk, hu = FXALZA.HU, xx=nope.cz, de=not a domain, at=");
  assert.deepEqual(domains, { sk: "fxalza.sk", hu: "fxalza.hu" });
  assert.equal(siteHost(SHOPS.sk, "fxalza.cz", domains), "fxalza.sk");
  assert.equal(siteHost(SHOPS.de, "fxalza.cz", domains), "de.fxalza.cz");
  assert.equal(siteHost(CZ, "fxalza.cz", domains), "fxalza.cz");
  assert.equal(siteUrl(SHOPS.hu, "fxalza.cz", domains), "https://fxalza.hu");
  assert.equal(shopOfHost("fxalza.sk", "fxalza.cz", domains), SHOPS.sk);
  assert.equal(shopOfHost("sk.fxalza.cz", "fxalza.cz", domains), SHOPS.sk);
  assert.equal(shopOfHost("fxalza.de", "fxalza.cz", domains), null);
  assert.deepEqual(parseSiteDomains(undefined), {});
});

test("shops are found by their top level domain", () => {
  assert.deepEqual(ALL_SHOPS.map((s) => s.tld), ["cz", "sk", "hu", "de", "at"]);
  assert.equal(shopByTld("SK"), SHOPS.sk);
  for (const tld of ["pl", "co.uk", "ch", "com", ""]) assert.equal(shopByTld(tld), null, tld);
});

test("prices are written the way the shop writes them", () => {
  assert.equal(formatMoney(CZ, 1349), "1 349 Kč");
  assert.equal(formatMoney(CZ, 367.04, true), "367,04 Kč");
  assert.equal(formatMoney(CZ, 367.04), "367 Kč");
  assert.equal(formatMoney(SHOPS.sk, 7.6), "7,60 €");
  assert.equal(formatMoney(SHOPS.sk, 1299), "1 299 €");
  // Alza.de writes it with a space as well, 2 299 €
  assert.equal(formatMoney(SHOPS.de, 1299.9), "1 299,90 €");
  assert.equal(formatMoney(SHOPS.at, 2319), "2 319 €");
  assert.equal(formatMoney(SHOPS.at, 137.9), "137,90 €");
  // Hungarian does not group four digits on its own
  assert.equal(formatMoney(SHOPS.hu, 2690), "2 690 Ft");
  assert.equal(formatMoney(SHOPS.hu, 1234567), "1 234 567 Ft");
});

test("ISIC is only asked for in the shops that have that price list", () => {
  const names = (code: keyof typeof SHOPS) => tiersFor(SHOPS[code]).map((t) => t.name);
  for (const code of ["cz", "sk", "de"] as const) assert.ok(names(code).includes("ISIC"), code);
  for (const code of ["hu", "at"] as const) assert.ok(!names(code).includes("ISIC"), code);
  assert.deepEqual(names("hu"), ["Gold", "Silver", "Bronze", "B2B", "Basic"]);
});

test("every language has every text, so no embed ends up with an empty one", () => {
  const reference = texts("cs");
  for (const shop of ALL_SHOPS) {
    const t = texts(shop.lang);
    assert.deepEqual(Object.keys(t.availability).sort(), Object.keys(reference.availability).sort(), shop.lang);
    for (const [key, value] of Object.entries(t)) {
      if (typeof value === "string") assert.ok(value.length > 0, `${shop.lang}.${key}`);
    }
    assert.ok(t.productFromAlza("1").includes("1"), shop.lang);
  }
});

test("a coupon is worded the way the shop's own users word it, and the entry keeps the code", () => {
  const coupon: PriceCandidate = { amount: 90, promo: true, priceType: null, name: "", coupon: "ABC10" };
  const basic: TierResult = { ...tier("Basic", 100), promos: [coupon] };
  const label = (shop: typeof CZ) => buildBenefits(new Map([["Basic", basic]]), shop).entries[0]!;
  assert.equal(label(CZ).label, "S kódem ABC10");
  assert.equal(label(SHOPS.sk).label, "S kódom ABC10");
  assert.equal(label(SHOPS.de).label, "Mit Code ABC10");
  // the Hungarian puts the code first
  assert.equal(label(SHOPS.hu).label, "ABC10 kuponkóddal");
  for (const shop of ALL_SHOPS) assert.equal(label(shop).coupon, "ABC10", shop.code);
});

test("the words for the other promotions are the ones of the extension", () => {
  assert.equal(texts("sk").promo, "Akčná cena");
  assert.equal(texts("de").promo, "Aktionspreis");
  assert.equal(texts("hu").promo, "Akciós ár");
  assert.equal(texts("hu").alzaplus, "AlzaPlus+");
  assert.equal(texts("de").tagTradein, "Inzahlungnahme");
  assert.equal(texts("hu").tagTradein, "beszámítás");
  assert.equal(texts("sk").tagTradein, "výkup");
});

test("ISIC gets its own cashback price when the API hands it the one of Basic", () => {
  const cashback = (amount: number): PriceCandidate => ({ amount, promo: true, priceType: 1, name: "Cena s Cashback", coupon: "" });
  const tierWith = (name: string, main: number, selected: PriceCandidate): TierResult => ({ tier: name, hidden: false, main: price(main), selected, promos: [selected] });
  // Basic 1000 with 100 cashback is 900; ISIC costs 950 on its own and the API says 900 as well
  const byTier = new Map<string, TierResult>([
    ["Basic", tierWith("Basic", 1000, cashback(900))],
    ["ISIC", tierWith("ISIC", 950, cashback(900))],
  ]);
  const isic = buildBenefits(byTier).entries.find((e) => e.kind === "tier")!;
  assert.deepEqual([isic.label, isic.price, isic.wasPriceText, isic.note], ["ISIC", 850, "950 Kč", "cashback"]);
  // euros keep their cents
  const eur = new Map<string, TierResult>([["Basic", tierWith("Basic", 10.5, cashback(9.9))], ["ISIC", tierWith("ISIC", 10, cashback(9.9))]]);
  assert.equal(buildBenefits(eur, SHOPS.sk).entries.find((e) => e.kind === "tier")!.price, 9.4);
  // an ISIC price that differs from Basic's cashback is left alone
  const own = new Map<string, TierResult>([["Basic", tierWith("Basic", 1000, cashback(900))], ["ISIC", tierWith("ISIC", 950, cashback(840))]]);
  assert.equal(buildBenefits(own).entries.find((e) => e.kind === "tier")!.price, 840);
  // no cashback, no change
  const plain = new Map<string, TierResult>([["Basic", tier("Basic", 1000)], ["ISIC", tier("ISIC", 950)]]);
  assert.equal(buildBenefits(plain).entries.find((e) => e.kind === "tier")!.price, 950);
});

test("an ISIC discount of its own still takes cashback and a trade-in, and keeps a cheaper coupon", () => {
  const promo = (amount: number, priceType: number, coupon = ""): PriceCandidate => ({
    amount,
    promo: true,
    priceType,
    name: coupon ? "Koupit s kódem" : priceType === 2 ? "S výkupním bonusem" : "Cena s Cashback",
    coupon,
  });
  const row = (name: string, main: number, promos: PriceCandidate[]): TierResult => {
    const list = price(main);
    const selected = promos.reduce((best, next) => (next.amount < best.amount ? next : best), list);
    return { tier: name, hidden: false, main: list, selected, promos };
  };
  const isic = (tiers: [string, TierResult][]) => {
    const entry = buildBenefits(new Map(tiers)).entries.find((e) => e.label.includes("ISIC"))!;
    return [entry.price, entry.note ?? null];
  };
  // 800 is already below the copied cashback of 900, and the 100 Basic gets still comes off
  assert.deepEqual(isic([["Basic", row("Basic", 1000, [promo(900, 1)])], ["ISIC", row("ISIC", 800, [promo(900, 1)])]]), [700, "cashback"]);
  // a copied trade-in bonus is the same kind of amount
  assert.deepEqual(isic([["Basic", row("Basic", 1000, [promo(700, 2)])], ["ISIC", row("ISIC", 950, [promo(700, 2)])]]), [650, "výkup"]);
  // a trade-in Alza already priced for ISIC stays as it came
  assert.deepEqual(isic([["Basic", row("Basic", 1000, [promo(700, 2)])], ["ISIC", row("ISIC", 950, [promo(650, 2)])]]), [650, "výkup"]);
  // a coupon cheaper than the copied cashback is kept (same as the Alza-Benefit-Prices extension)
  assert.deepEqual(
    isic([
      ["Basic", row("Basic", 1000, [promo(800, 3, "ALZADNY20"), promo(900, 1)])],
      ["ISIC", row("ISIC", 950, [promo(760, 3, "ALZADNY20"), promo(900, 1)])],
    ]),
    [760, "kód"],
  );
  assert.deepEqual(isic([["Basic", row("Basic", 1000, [promo(800, 3, "ALZADNY20")])], ["ISIC", row("ISIC", 950, [promo(760, 3, "ALZADNY20")])]]), [760, "kód"]);
  // cashback wins only when it undercuts the coupon
  assert.deepEqual(
    isic([
      ["Basic", row("Basic", 1000, [promo(900, 3, "ALZADNY10"), promo(850, 1)])],
      ["ISIC", row("ISIC", 950, [promo(900, 3, "ALZADNY10"), promo(850, 1)])],
    ]),
    [800, "cashback"],
  );
});

test("ISIC with the same coupon price as Silver shares one line", () => {
  const coupon = (amount: number): PriceCandidate => ({ amount, promo: true, priceType: 3, name: "Koupit s kódem ALZADNY40", coupon: "ALZADNY40" });
  const row = (name: string, main: number, withCode: number): TierResult => ({
    tier: name,
    hidden: false,
    main: price(main),
    selected: coupon(withCode),
    promos: [coupon(withCode)],
  });
  const entries = buildBenefits(
    new Map([
      ["Basic", row("Basic", 1831, 1099)],
      ["Silver", row("Silver", 1364, 819)],
      ["ISIC", row("ISIC", 1364, 819)],
    ]),
  ).entries.filter((e) => e.kind === "tier");
  assert.deepEqual(
    entries.map((e) => [e.label, e.price, e.note]),
    [["Silver/ISIC", 819, "kód"]],
  );
});

const price = (amount: number): PriceCandidate => ({ amount, promo: false, priceType: null, name: "", coupon: "" });
const tier = (name: string, amount: number): TierResult => ({ tier: name, hidden: false, selected: price(amount), main: price(amount), promos: [] });

test("club prices and promotions come out in the language and currency of the shop", () => {
  const coupon: PriceCandidate = { amount: 6.5, promo: true, priceType: null, name: "", coupon: "ABC10" };
  const basic: TierResult = { ...tier("Basic", 7.89), promos: [coupon] };
  const byTier = new Map<string, TierResult>([["Basic", basic], ["Gold", tier("Gold", 7.6)]]);
  const sk = buildBenefits(byTier, SHOPS.sk).entries;
  assert.deepEqual(sk.map((e) => [e.kind, e.label, e.priceText]), [["coupon", "S kódom ABC10", "6,50 €"], ["tier", "Gold", "7,60 €"]]);
  const de = buildBenefits(byTier, SHOPS.de).entries;
  assert.equal(de[0]!.label, "Mit Code ABC10");
  // 7.89 to 6.50 is 17.6 %; the half crown of tolerance that suits crowns would have made it 23 % in euros
  assert.equal(sk[0]!.percentShown, 17);
  const hu = buildBenefits(new Map([["Basic", tier("Basic", 2690)], ["Gold", tier("Gold", 2460)]]), SHOPS.hu).entries;
  assert.equal(hu[0]!.priceText, "2 460 Ft");
  // the Czech default is what it always was
  assert.equal(buildBenefits(byTier).entries[0]!.label, "S kódem ABC10");
});

test("a shop with no ISIC list is complete without it", () => {
  const six = new Map(["Basic", "Gold", "Silver", "ISIC", "Bronze", "B2B"].map((n) => [n, tier(n, 100)] as [string, TierResult]));
  assert.equal(buildBenefits(six, CZ).complete, true);
  const five = new Map([...six].filter(([n]) => n !== "ISIC"));
  assert.equal(buildBenefits(five, CZ).complete, false);
  assert.equal(buildBenefits(five, SHOPS.hu).complete, true);
});

test("the condition of second hand goods is told in the language of the shop", () => {
  const used = "https://schema.org/UsedCondition";
  assert.equal(conditionText("https://schema.org/RefurbishedCondition", "", SHOPS.de), "Generalüberholt");
  assert.equal(conditionText(used, "<html></html>", SHOPS.sk), "Použité");
  assert.equal(conditionText(used, "<html></html>", SHOPS.hu), "Használt");
  // only the Czech page names the grade of the piece
  const label = `<span class="stcStock avlVal avl2 none" title="Zánovní - skladem 3 ks">Zánovní</span>`;
  assert.equal(conditionText(used, label, CZ), "Zánovní");
  assert.equal(conditionText(used, label, SHOPS.sk), "Použité");
  assert.equal(conditionText("https://schema.org/NewCondition", "", SHOPS.de), null);
});

test("the www. of a shop's own domain is that shop, not the Czech one", () => {
  const domains = parseSiteDomains("sk=fxalza.sk");
  assert.equal(shopOfHost("www.fxalza.sk", "fxalza.cz", domains), SHOPS.sk);
  // without a domain of its own, www. stays what it was
  assert.equal(shopOfHost("www.fxalza.cz", "fxalza.cz", domains), null);
});

test("a coupon named after its percent shows that percent when the calculated one is a point off", () => {
  const price = (amount: number, extra: Partial<PriceCandidate> = {}): PriceCandidate => ({ amount, promo: false, priceType: null, name: "", coupon: "", ...extra });
  const tier = (name: string, amount: number, promos: PriceCandidate[] = []): TierResult => ({ tier: name, hidden: false, selected: price(amount), main: price(amount), promos });
  // 1000 to 851.50 is 14.85 %, the code says 15
  const withCode = (coupon: string) =>
    buildBenefits(new Map([["Basic", tier("Basic", 1000, [price(851.5, { promo: true, coupon })])]])).entries[0]!.percentShown;
  assert.equal(withCode("SLEVA15"), 15);
  assert.equal(withCode("SLEVA"), 14);
  // a code that has nothing to do with the discount is ignored
  assert.equal(withCode("ABC99"), 14);
});

test("Alza names its promotions in Czech, and only the Czech shop shows them as they come", () => {
  const promo = (priceType: number | null, name: string): PriceCandidate => ({ amount: 90, promo: true, priceType, name, coupon: "" });
  const entry = (shop: typeof CZ, p: PriceCandidate) =>
    buildBenefits(new Map([["Basic", { tier: "Basic", hidden: false, main: price(100), selected: p, promos: [p] } as TierResult]]), shop).entries[0]!.label;
  assert.equal(entry(CZ, promo(2, "S výkupním bonusem")), "S výkupním bonusem");
  assert.equal(entry(SHOPS.hu, promo(2, "S výkupním bonusem")), "Beszámítással");
  assert.equal(entry(SHOPS.de, promo(1, "Cena s Cashback")), "Mit Cashback");
  assert.equal(entry(SHOPS.sk, promo(1, "Cena s Cashback")), "S Cashback");
  assert.equal(entry(CZ, promo(1, "Cena s Cashback")), "Cena s Cashback");
  // the standard Czech promotion is translated, one with a name of its own is not
  assert.equal(entry(SHOPS.hu, promo(null, "Akční cena")), "Akciós ár");
  assert.equal(entry(SHOPS.hu, promo(null, "Black Friday")), "Black Friday");
});
