import test from "node:test";
import assert from "node:assert/strict";
import { blackFridayEntry, withBlackFriday, type BenefitEntry } from "../src/alza.ts";
import { CZ } from "../src/shops.ts";

const BOX = `<div class="price-detail__price-box-wrapper js-price-detail__main-price-box-wrapper" data-testid="price-primary">
  <span class="ads-pb js-price-box ads-pb--black-friday ads-pb--basic ads-pb--big" data-slot="pb-wrapper">
    <span data-slot="pb-inner">
      <span class="ads-pb__header" data-slot="pb-title"><span>BLACK FRIDAY -22&nbsp;%</span></span>
      <span class="ads-pb__body" data-slot="pb-price-wrapper">
        <span class="ads-pb__price" data-slot="pb-price"><span class="ads-pb__price-value js-price-box__primary-price__value">22&nbsp;990,-</span></span>
        <span class="ads-pb__original-price ads-pb__original-price--strike js-compare-price">29&nbsp;490,-</span>
      </span>
    </span>
    <div class="ads-pb__footer" data-slot="pb-footer"><div><span class="js-secondary-price">bez DPH&nbsp;19&nbsp;000,-</span></div></div>
  </span>
</div>`;

test("the Black Friday price box gives the price, the crossed out price and the percent", () => {
  const e = blackFridayEntry(`<html>${BOX}</html>`, CZ);
  assert.ok(e);
  assert.equal(e.kind, "blackfriday");
  assert.equal(e.price, 22990);
  assert.equal(e.percentShown, 22);
  assert.match(e.wasPriceText ?? "", /29\s?490/);
});

test("a page without the Black Friday box has no such entry", () => {
  assert.equal(blackFridayEntry(BOX.replace("ads-pb--black-friday", "ads-pb--sale"), CZ), null);
});

test("other prices are measured from the crossed out price, like Alza does on a Black Friday page", () => {
  const bf = blackFridayEntry(BOX.replace("22&nbsp;990", "175").replace("29&nbsp;490", "219").replace("-22&nbsp;%", "-20&nbsp;%"), CZ)!;
  const plus: BenefitEntry = { kind: "alzaplus", label: "S AlzaPlus+", price: 166, priceText: "166 Kč", percent: 5.1, percentShown: 5 };
  const sale: BenefitEntry = { kind: "sale", label: "Sleva", price: 175, priceText: "175 Kč", percent: 10, percentShown: 10 };
  const out = withBlackFriday([sale, plus], bf, CZ);
  assert.deepEqual(out.map((b) => b.kind), ["blackfriday", "alzaplus"]);
  assert.equal(out[1]!.percentShown, 24);
  assert.equal("was" in out[0]!, false);
});
