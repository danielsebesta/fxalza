import { readFileSync } from "node:fs";
import type { BenefitEntry } from "./alza.ts";

const IDS_FILE = new URL("../assets/emoji/ids.json", import.meta.url);

function loadIds(): Record<string, string> {
  try {
    return JSON.parse(readFileSync(IDS_FILE, "utf8")) as Record<string, string>;
  } catch {
    return {};
  }
}

const ids = loadIds();

export function emojiRef(name: string): { name: string; id: string } | null {
  const id = ids[name];
  return id ? { name, id } : null;
}

export function emojiMd(name: string, fallback: string): string {
  const e = emojiRef(name);
  return e ? `<:${e.name}:${e.id}>` : fallback;
}

const KIND: Record<BenefitEntry["kind"], [string, string]> = {
  sale: ["alza_sale", "🏷️"],
  coupon: ["alza_coupon", "🎟️"],
  alzaplus: ["alza_plus", "💳"],
  cashback: ["alza_cashback", "💰"],
  tradein: ["alza_tradein", "♻️"],
  promo: ["alza_promo", "🏷️"],
  tier: ["alza_basic", "🏅"],
};

const TIER: Record<string, string> = {
  gold: "alza_gold",
  silver: "alza_silver",
  bronze: "alza_bronze",
  isic: "alza_isic",
  b2b: "alza_b2b",
};

export function benefitEmoji(e: BenefitEntry, custom: boolean): string {
  const [name, fallback] = KIND[e.kind];
  if (!custom) return fallback;
  if (e.kind === "tier") {
    return emojiMd(TIER[e.label.split("/")[0]!.toLowerCase()] ?? name, fallback);
  }
  return emojiMd(name, fallback);
}
