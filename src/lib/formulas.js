// Pure game-math functions (damage/kill/session-profit formulas), extracted from
// App.jsx so they're independently unit-testable without any React/browser/global
// dependencies -- everything here is a plain function of its arguments (plus the
// data-module imports below, which are themselves plain data).
import { EXP_TABLE } from "../data/expTable";
import { MOB_INCOME_PER_KILL } from "../data/mobDrops";

// -- Default character stats (overridden by UI panel) -----------------------
export const DEFAULT_CHAR = { level:20, int:87, luk:23, weaponMatk:21, mpMax:571, expPct:28 };
// AP distribution per level: +4 INT, +1 LUK
export const INT_PER_LEVEL = 4;
export const LUK_PER_LEVEL = 1;

export function statsAtLevel(lvl, baseChar) {
  const g = lvl - baseChar.level;
  const int_ = baseChar.int + g * INT_PER_LEVEL;
  const luk_ = baseChar.luk + g * LUK_PER_LEVEL;
  const mpMax = baseChar.mpMax + g * (6 + Math.floor((baseChar.int + g * 2) / 10));
  return { level:lvl, int:int_, luk:luk_, weaponMatk:baseChar.weaponMatk, mpMax };
}

export const EXP_MULTI = 2;
export const SPELL_ATK = 40, MASTERY = 0.60;
// Magic Claw fires 2 separate hits per cast, each rolled independently off this formula.
export const MC_HITS_PER_CAST = 2;

export function calcDmg(matk, int_) {
  const magic = matk + int_;
  return {
    min: ((magic**2/1000 + magic*MASTERY*0.9)/30 + int_/200)*SPELL_ATK,
    max: ((magic**2/1000 + magic)/30 + int_/200)*SPELL_ATK,
  };
}

export function hitsToKill(hp, mdef, dmgMin) {
  const eh = hp + mdef;
  if (dmgMin >= eh) return 1;
  if (dmgMin * 2 >= eh) return 2;
  return Math.ceil(eh / dmgMin);
}

// -- Heal skill formula (v62 pre-BB, source: Ayumilove/Southperry formula compilation) --
// Heal Lv N: MP cost = 29 + N, Skill% = N * 15%
// MIN = (INT*0.3 + LUK) * Magic/1000 * HEAL_TARGET_MULT * skillPct
// MAX = (INT*1.2 + LUK) * Magic/1000 * HEAL_TARGET_MULT * skillPct
//
// HEAL_TARGET_MULT is STRICTLY the Heal HP-recovery formula's own multiplier --
// it scales with the number of PARTY MEMBERS being healed, including the caster
// ("1.5 + 5/partySize": 1=6.5, 2=4.0, 3=3.167, 4=2.75, 5=2.5, 6=2.333), and has
// nothing to do with how many undead monsters get damaged. This app has no party
// mechanics -- it's a solo-training calculator -- so partySize is always 1,
// giving a fixed 6.5x. Per-target Heal damage does NOT drop as you hit more
// undead; the "Undead Hit / Cast" slider below only affects kill throughput
// (exp/kills per cast, MP Eater proc rolls), never this multiplier.
export const HEAL_TARGET_MULT = 1.5 + 5 / 1;
export function healDmg(healLvl, int_, luk, weaponMatk) {
  if (healLvl === 0) return { min: 0, max: 0, mpCost: 0 };
  const magic = int_ + weaponMatk;
  const skillPct = (healLvl * 15) / 100;
  const mpCost = 29 + healLvl;
  const min = (int_ * 0.3 + luk) * magic / 1000 * HEAL_TARGET_MULT * skillPct;
  const max = (int_ * 1.2 + luk) * magic / 1000 * HEAL_TARGET_MULT * skillPct;
  return { min, max, mpCost };
}

export function healCastsToKill(hp, mdef, healLvl, int_, luk, weaponMatk) {
  if (healLvl === 0) return null;
  const eh = hp + mdef;
  const { min } = healDmg(healLvl, int_, luk, weaponMatk);
  if (min <= 0) return null;
  return Math.ceil(eh / min);
}

export function oneshotLevel(hp, mdef, baseChar) {
  const eh = hp + mdef;
  for (let lvl = baseChar.level; lvl <= 80; lvl++) {
    const s = statsAtLevel(lvl, baseChar);
    const d = calcDmg(s.weaponMatk, s.int);
    if (d.min * MC_HITS_PER_CAST >= eh) return lvl;
  }
  return null;
}

// MP Eater (passive, 2nd job): chance to absorb % of mob's max MP per hit
// Lv N: N% chance, absorb N/2% of mob's max MP (Lv1=1%/1%, Lv20=20%/10%)
// Fires independently per hit: Magic Claw = 2 rolls, Heal vs N targets = N rolls
export function mpEaterAbsorbPerProc(mpEaterLvl, mobMp) {
  return mobMp * (mpEaterLvl / 200); // absorb N/2 % of mob MP
}
export function mpEaterProcChance(mpEaterLvl) {
  return mpEaterLvl / 100; // N% chance per hit
}
// Expected MP recovered per cast (accounting for multiple hits/targets)
export function mpEaterExpectedReturn(mpEaterLvl, mobMp, numHits) {
  if (mpEaterLvl === 0 || mobMp === 0) return 0;
  const procChance = mpEaterProcChance(mpEaterLvl);
  const absorbPerProc = mpEaterAbsorbPerProc(mpEaterLvl, mobMp);
  return procChance * absorbPerProc * numHits;
}
// Probability of at least one MP Eater proc across N hits
export function mpEaterAnyProcChance(mpEaterLvl, numHits) {
  if (mpEaterLvl === 0) return 0;
  return 1 - Math.pow(1 - mpEaterProcChance(mpEaterLvl), numHits);
}
// Net expected MP cost after MP Eater return
export function netMpCost(baseMpCost, mpEaterReturn) {
  return Math.max(0, baseMpCost - mpEaterReturn);
}

// Given total EXP gained in a session, starting from CHAR.level with 0% progress,
// calculate levels gained and leftover % into next level
export function calcLevelsGained(totalExpGained, startLevel, startExpPct) {
  // Convert starting exp% into actual exp already earned this level
  const startLvlExp = EXP_TABLE[startLevel] || 0;
  const startExpEarned = Math.floor(startLvlExp * startExpPct / 100);
  let remaining = totalExpGained;
  let lvl = startLevel;
  // First level: offset by already-earned exp
  const firstLvlRemaining = startLvlExp - startExpEarned;
  if (remaining >= firstLvlRemaining) {
    remaining -= firstLvlRemaining;
    lvl++;
  } else {
    // Didn't even finish current level
    const leftoverPct = ((startExpEarned + remaining) / startLvlExp) * 100;
    return { levelsGained: 0, leftoverPct, finalLevel: lvl };
  }
  let levelsGained = 1;
  while (remaining > 0 && lvl < EXP_TABLE.length) {
    const needed = EXP_TABLE[lvl];
    if (!needed) break;
    if (remaining >= needed) {
      remaining -= needed;
      lvl++;
      levelsGained++;
    } else {
      break;
    }
  }
  const currentLvlNeeded = EXP_TABLE[lvl] || EXP_TABLE[EXP_TABLE.length - 1];
  const leftoverPct = currentLvlNeeded > 0 ? (remaining / currentLvlNeeded) * 100 : 0;
  return { levelsGained, leftoverPct, finalLevel: lvl };
}
// Income per kill: real per-monster mesos drop EV + sellable item/equip drop EV,
// computed from Cosmic's actual drop tables + Item.wz/Character.wz NPC sell prices
// (see tools/extract_mob_drops.mjs -- MOB_INCOME_PER_KILL is keyed by MONSTER_DB id).
// A handful of monsters have no matching drop_data rows in the source dump; those
// fall back to the dataset-wide average rather than a single universal constant.
const MOB_INCOME_VALUES = Object.values(MOB_INCOME_PER_KILL);
export const FALLBACK_INCOME_PER_KILL = MOB_INCOME_VALUES.reduce((a, b) => a + b, 0) / MOB_INCOME_VALUES.length;
export function incomePerKillFor(mobId) {
  const v = MOB_INCOME_PER_KILL[mobId];
  return v !== undefined ? v : FALLBACK_INCOME_PER_KILL;
}
export const MC_CAST_TIME_SEC = 2.0;   // seconds per Magic Claw kill (cast + reposition)
export const HEAL_CAST_TIME_SEC = 3.0; // seconds per Heal cycle (cast + move to next group)

// MP-restore items available for session profit calc, verified against v62 Item.wz Consume data
// (private-server prices: some drop-only items are NPC-purchasable for convenience here)
export const POTIONS = {
  bluePotion: { label: "Blue Potion (100m / 100MP)", cost: 100, mpFlat: 100, mpPct: null },
  manaElixir: { label: "Mana Elixir (310m / 300MP)", cost: 310, mpFlat: 300, mpPct: null },
  elixir: { label: "Elixir (1000m / 50% MP)", cost: 1000, mpFlat: null, mpPct: 0.5 },
  powerElixir: { label: "Power Elixir (2500m / 100% MP)", cost: 2500, mpFlat: null, mpPct: 1.0 },
};

export function sessionProfit(minutes, skill, killsPerCast, netMpCostPerCast, expPerKill, charLevel, charExpPct, potionKey, charMpMax, incomePerKill) {
  const potion = POTIONS[potionKey] || POTIONS.bluePotion;
  const mpPerPotion = potion.mpFlat != null ? potion.mpFlat : potion.mpPct * (charMpMax || 1);
  const secs = minutes * 60;
  const castTime = skill === "heal" ? HEAL_CAST_TIME_SEC : MC_CAST_TIME_SEC;
  const casts = secs / castTime;
  const kills = casts * killsPerCast;
  const potsNeeded = (casts * netMpCostPerCast) / mpPerPotion;
  const potCost = potsNeeded * potion.cost;
  const income = kills * incomePerKill;
  const profit = income - potCost;
  const totalExp = kills * expPerKill * EXP_MULTI;
  const { levelsGained, leftoverPct, finalLevel } = calcLevelsGained(totalExp, charLevel, charExpPct);
  return {
    casts: Math.round(casts),
    kills: Math.round(kills),
    potCost: Math.round(potCost),
    income: Math.round(income),
    profit: Math.round(profit),
    totalExp: Math.round(totalExp),
    levelsGained,
    leftoverPct,
    finalLevel,
  };
}
