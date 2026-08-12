// Pure game-math functions (damage/kill/session-profit formulas), extracted from
// App.jsx so they're independently unit-testable without any React/browser/global
// dependencies -- everything here is a plain function of its arguments (plus the
// data-module imports below, which are themselves plain data).
import { EXP_TABLE } from "../data/expTable";
import { MOB_INCOME_PER_KILL } from "../data/mobDrops";

// -- Default character stats (overridden by UI panel) -----------------------
// str/dex exist so the stat block works for any class's AP distribution (see
// classSkills.js), not just Magician -- Magic Claw/Heal (the only verified skills
// today) only ever read int/luk/weaponAtk, so str/dex sit at a nominal base value.
export const DEFAULT_CHAR = { level:20, str:4, dex:4, int:87, luk:23, weaponAtk:21, mpMax:571, expPct:28 };

// Which stats grow per level and by how much, under a "full offense" AP build --
// this app only ever models one build style per class (matching how it already
// hardcoded Magician's +4 INT/+1 LUK regardless of user choice before classes
// existed at all). Keyed by class; see classSkills.js for the class registry.
export const AP_DISTRIBUTIONS = {
  magician: { primaryStat: "int", primaryPerLevel: 4, secondaryStat: "luk", secondaryPerLevel: 1 },
  warrior:  { primaryStat: "str", primaryPerLevel: 4, secondaryStat: "dex", secondaryPerLevel: 1 },
  bowman:   { primaryStat: "dex", primaryPerLevel: 4, secondaryStat: "str", secondaryPerLevel: 1 },
  thief:    { primaryStat: "luk", primaryPerLevel: 4, secondaryStat: "dex", secondaryPerLevel: 1 },
  pirate:   { primaryStat: "str", primaryPerLevel: 4, secondaryStat: "dex", secondaryPerLevel: 1 },
};
// Magician's distribution under its old name, kept exported for anything that
// still wants the literal historical constants.
export const INT_PER_LEVEL = AP_DISTRIBUTIONS.magician.primaryPerLevel;
export const LUK_PER_LEVEL = AP_DISTRIBUTIONS.magician.secondaryPerLevel;

// Projects baseChar's stats forward/backward to `lvl` using the given AP distribution
// (see AP_DISTRIBUTIONS). MP growth is INT-based regardless of class -- a real classic
// mechanic, not a Magician-only quirk: non-Magician classes just have a low, ~flat INT
// so this term stays small, which is why Warriors famously have tiny MP pools.
export function statsAtLevel(lvl, baseChar, apDistribution) {
  const g = lvl - baseChar.level;
  const stats = { ...baseChar, level: lvl };
  stats[apDistribution.primaryStat] = baseChar[apDistribution.primaryStat] + g * apDistribution.primaryPerLevel;
  stats[apDistribution.secondaryStat] = baseChar[apDistribution.secondaryStat] + g * apDistribution.secondaryPerLevel;
  stats.mpMax = baseChar.mpMax + g * (6 + Math.floor((baseChar.int + g * 2) / 10));
  return stats;
}

export const EXP_MULTI = 2;
export const SPELL_ATK = 40, MASTERY = 0.60;
// Magic Claw fires 2 separate hits per cast, each rolled independently off this formula.
export const MC_HITS_PER_CAST = 2;

// v62 pre-BB Magic Claw formula (Magician 1st job, any branch) -- verified this
// session against the app's pre-existing hardcoded behavior; see README "Efficiency
// metric" for how a wrong version of this class of formula was caught and fixed.
export function calcDmg(matk, int_) {
  const magic = matk + int_;
  return {
    min: ((magic**2/1000 + magic*MASTERY*0.9)/30 + int_/200)*SPELL_ATK,
    max: ((magic**2/1000 + magic)/30 + int_/200)*SPELL_ATK,
  };
}

// General v62 pre-BB magic damage formula, generalizing calcDmg above to any magic
// skill's own per-level (mad, mastery) pair instead of Magic Claw's fixed SPELL_ATK/
// MASTERY constants. Verified two ways: (1) calibration -- Magic Claw's own Skill.wz
// entry (id 2001005) has mad=40 and mastery=10 at its max level (20), EXACTLY
// reproducing calcDmg's already-verified SPELL_ATK=40/MASTERY=0.6 constants (0.6 =
// 10 * 0.06, the mastery-field-to-percent conversion below), so this isn't a new
// unverified formula -- it's calcDmg's own formula shape confirmed to be driven by
// these exact wz fields; (2) a southperry.net formula-compilation thread (indexed by
// web search; the live thread itself 404s now) independently describes "Spell
// Attack" as the same named, per-skill multiplier term. "mad"/"mastery" per level
// for a given skill are read directly from Skill.wz -- see classSkills.js.
export function magicSkillDamage(matk, int_, spellAtk, masteryField) {
  const magic = matk + int_;
  const masteryPct = masteryField * 0.06;
  return {
    min: ((magic**2/1000 + magic*masteryPct*0.9)/30 + int_/200)*spellAtk,
    max: ((magic**2/1000 + magic)/30 + int_/200)*spellAtk,
  };
}

// -- Elemental weakness/resist/immune damage multiplier -------------------------
// Standard, widely-documented classic MapleStory constants (weak x1.5, resist x0.5,
// immune x0) -- unlike the skill formulas above, this wasn't re-derived from this
// session's Skill.wz/VoidMS sourcing pass (VoidMS's server code gates elemental
// STATUS EFFECTS like poison/stun on these tiers but never exposes a numeric damage
// multiplier -- that scaling appears to be purely client-side in v62), so treat this
// specific constant as "well-established community knowledge", not wz-verified.
export const ELEMENTAL_MULTIPLIER = { weak: 1.5, normal: 1, strong: 0.5, immune: 0 };
// monster: { weak, strong, immune } strings from monsterDb.js (e.g. "Fire", "-", or
// a "Holy/Fire" combo for weak). skillElement: lowercase element key on a SKILLS
// entry (e.g. "fire") or null/undefined for non-elemental skills (always normal).
export function elementalMultiplier(skillElement, monster) {
  if (!skillElement) return ELEMENTAL_MULTIPLIER.normal;
  const el = skillElement.toLowerCase();
  const matches = field => !!field && field !== "-" && field.toLowerCase().split("/").includes(el);
  if (matches(monster.immune)) return ELEMENTAL_MULTIPLIER.immune;
  if (matches(monster.strong)) return ELEMENTAL_MULTIPLIER.strong;
  if (matches(monster.weak)) return ELEMENTAL_MULTIPLIER.weak;
  return ELEMENTAL_MULTIPLIER.normal;
}
export function scaleDamage(dmg, mult) {
  return { min: dmg.min * mult, max: dmg.max * mult };
}

// -- Physical (weapon-based) damage formula, v62 pre-BB -- sourced from VoidMS
// (github.com/hugogrochau/VoidMS, a v62-era private server), src/client/MapleCharacter.java
// calculateMaxBaseDamage()/calculateMinBaseDamage(), and MapleWeaponType.java for the
// per-weapon multipliers. Same formula family as Magic Claw's magic damage above, just
// the physical-side equivalent -- verified against real server source rather than a
// secondary wiki compilation (see classSkills.js header for why that mattered here).
//
// MAX = ((weaponMulti * mainStat + secondaryStat) / 100) * watk + 10
// MIN = ((mainStat * 0.9 * weaponMulti * masteryFactor + secondaryStat) / 100) * (watk + rangedBonus)
//
// masteryFactor is fixed at 0.1 (the VoidMS source's "unlearned" default) because Weapon
// Mastery is a 2nd-job passive -- every skill wired up below (Power Strike, Slash Blast,
// Double Shot, Lucky Seven, Somersault Kick) is a 1st-job skill, so no character using
// them has Mastery invested yet. rangedBonus is a flat +15 to watk that VoidMS's min-damage
// branch applies to Bow/Crossbow/Claw specifically (not Sword/Axe/Spear/Knuckle) --
// preserved here since it's directly in the source, not an approximation of it.
export const WEAPON_MULTIPLIERS = {
  bow: 3.4, claw: 3.6, dagger: 4.0, crossbow: 3.6,
  axe1h: 4.4, sword1h: 4.0, blunt1h: 4.4, axe2h: 4.8, sword2h: 4.6, blunt2h: 4.8,
  poleArm: 5.0, spear: 5.0, staff: 3.6, wand: 3.6, knuckle: 4.0, gun: 5.0,
};
export function physicalBaseDamage(weaponMulti, mainStat, secondaryStat, watk, rangedBonus = 0) {
  const masteryFactor = 0.1;
  const max = ((weaponMulti * mainStat + secondaryStat) / 100) * watk + 10;
  const min = ((mainStat * 0.9 * weaponMulti * masteryFactor + secondaryStat) / 100) * (watk + rangedBonus);
  return { min, max };
}
// skillPct is the skill's own damage% at the level being modeled (this app models each
// class at its 1st-job skill's max level -- see classSkills.js -- same "one build style
// per class" simplification AP_DISTRIBUTIONS already makes).
export function physicalSkillDamage(weaponMulti, mainStat, secondaryStat, watk, skillPct, rangedBonus = 0) {
  const base = physicalBaseDamage(weaponMulti, mainStat, secondaryStat, watk, rangedBonus);
  return { min: base.min * skillPct / 100, max: base.max * skillPct / 100 };
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
export function healDmg(healLvl, int_, luk, weaponAtk) {
  if (healLvl === 0) return { min: 0, max: 0, mpCost: 0 };
  const magic = int_ + weaponAtk;
  const skillPct = (healLvl * 15) / 100;
  const mpCost = 29 + healLvl;
  const min = (int_ * 0.3 + luk) * magic / 1000 * HEAL_TARGET_MULT * skillPct;
  const max = (int_ * 1.2 + luk) * magic / 1000 * HEAL_TARGET_MULT * skillPct;
  return { min, max, mpCost };
}

export function healCastsToKill(hp, mdef, healLvl, int_, luk, weaponAtk) {
  if (healLvl === 0) return null;
  const eh = hp + mdef;
  const { min } = healDmg(healLvl, int_, luk, weaponAtk);
  if (min <= 0) return null;
  return Math.ceil(eh / min);
}

// Generic "what level would one-shot this" search, driven by the active skill's own
// AP distribution + damage formula + hits-per-cast -- works for any verified skill,
// not just Magic Claw. `dmgFn(stats)` must return { min, max } (see classSkills.js).
export function oneshotLevel(hp, mdef, baseChar, apDistribution, dmgFn, hitsPerCast) {
  const eh = hp + mdef;
  for (let lvl = baseChar.level; lvl <= 80; lvl++) {
    const s = statsAtLevel(lvl, baseChar, apDistribution);
    const d = dmgFn(s);
    if (d.min * hitsPerCast >= eh) return lvl;
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

// castTimeSec is the active skill's own cast time (see classSkills.js) -- generic
// over any skill rather than special-casing "mc" vs "heal" by name.
export function sessionProfit(minutes, castTimeSec, killsPerCast, netMpCostPerCast, expPerKill, charLevel, charExpPct, potionKey, charMpMax, incomePerKill) {
  const potion = POTIONS[potionKey] || POTIONS.bluePotion;
  const mpPerPotion = potion.mpFlat != null ? potion.mpFlat : potion.mpPct * (charMpMax || 1);
  const secs = minutes * 60;
  const casts = secs / castTimeSec;
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
