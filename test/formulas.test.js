import { describe, it, expect } from "vitest";
import {
  DEFAULT_CHAR, AP_DISTRIBUTIONS, INT_PER_LEVEL, LUK_PER_LEVEL, statsAtLevel,
  EXP_MULTI, calcDmg, hitsToKill,
  HEAL_TARGET_MULT, healDmg, healCastsToKill, oneshotLevel,
  mpEaterAbsorbPerProc, mpEaterProcChance, mpEaterExpectedReturn, mpEaterAnyProcChance, netMpCost,
  calcLevelsGained, FALLBACK_INCOME_PER_KILL, incomePerKillFor,
  MC_CAST_TIME_SEC, HEAL_CAST_TIME_SEC, MC_HITS_PER_CAST, POTIONS, sessionProfit,
  physicalBaseDamage, physicalSkillDamage, WEAPON_MULTIPLIERS,
  magicSkillDamage, elementalMultiplier, scaleDamage, ELEMENTAL_MULTIPLIER,
  HP_POTIONS, incomingDamagePerHit, hpLossPerSecond, isSuspiciousPotionPrice,
  MAGIC_GUARD_LEVELS, magicGuardPct, applyMagicGuard,
} from "../src/lib/formulas";
import { SKILLS } from "../src/lib/classSkills";
import { EXP_TABLE } from "../src/data/expTable";
import { MOB_INCOME_PER_KILL } from "../src/data/mobDrops";

describe("statsAtLevel", () => {
  const base = { level: 20, str: 4, dex: 4, int: 87, luk: 23, weaponAtk: 21, mpMax: 571 };
  const magician = AP_DISTRIBUTIONS.magician;

  it("returns the base stats unchanged at the base level", () => {
    const s = statsAtLevel(20, base, magician);
    expect(s).toEqual(base);
  });

  it("adds +4 INT / +1 LUK per level gained (Magician distribution)", () => {
    const s = statsAtLevel(21, base, magician);
    expect(s.int).toBe(base.int + INT_PER_LEVEL);
    expect(s.luk).toBe(base.luk + LUK_PER_LEVEL);
  });

  it("matches the reference computation at level 25", () => {
    const s = statsAtLevel(25, base, magician);
    expect(s).toEqual({ level: 25, str: 4, dex: 4, int: 107, luk: 28, weaponAtk: 21, mpMax: 646 });
  });

  it("never changes weaponAtk (gear-driven, not level-driven)", () => {
    expect(statsAtLevel(40, base, magician).weaponAtk).toBe(base.weaponAtk);
  });

  it("handles going down in level (negative g) symmetrically", () => {
    const up = statsAtLevel(25, base, magician);
    const down = statsAtLevel(20, up, magician);
    expect(down.int).toBe(base.int);
    expect(down.luk).toBe(base.luk);
  });

  it("uses a different class's AP distribution to grow different stats", () => {
    const s = statsAtLevel(21, base, AP_DISTRIBUTIONS.warrior);
    expect(s.str).toBe(base.str + AP_DISTRIBUTIONS.warrior.primaryPerLevel);
    expect(s.dex).toBe(base.dex + AP_DISTRIBUTIONS.warrior.secondaryPerLevel);
    // and leaves int/luk untouched since Warrior's distribution doesn't grow them
    expect(s.int).toBe(base.int);
    expect(s.luk).toBe(base.luk);
  });
});

describe("AP_DISTRIBUTIONS", () => {
  it("has an entry for every class the skill registry references", () => {
    for (const cls of ["magician", "warrior", "bowman", "thief", "pirate"]) {
      expect(AP_DISTRIBUTIONS[cls]).toBeTruthy();
      expect(typeof AP_DISTRIBUTIONS[cls].primaryStat).toBe("string");
      expect(typeof AP_DISTRIBUTIONS[cls].secondaryStat).toBe("string");
    }
  });
});

describe("calcDmg", () => {
  it("matches the reference computation for matk=21, int=87", () => {
    const d = calcDmg(21, 87);
    expect(d.min).toBeCloseTo(110.712, 3);
    expect(d.max).toBeCloseTo(176.952, 3);
  });

  it("max damage is always >= min damage", () => {
    for (const [matk, int_] of [[0, 0], [21, 87], [200, 999], [1, 1]]) {
      const d = calcDmg(matk, int_);
      expect(d.max).toBeGreaterThanOrEqual(d.min);
    }
  });

  it("damage increases monotonically with INT", () => {
    const low = calcDmg(21, 50);
    const high = calcDmg(21, 200);
    expect(high.min).toBeGreaterThan(low.min);
    expect(high.max).toBeGreaterThan(low.max);
  });

  it("returns zero damage for zero matk/int", () => {
    const d = calcDmg(0, 0);
    expect(d.min).toBe(0);
    expect(d.max).toBe(0);
  });
});

describe("hitsToKill", () => {
  it("returns 1 when min damage alone kills (one-shot)", () => {
    expect(hitsToKill(100, 0, 100)).toBe(1);
    expect(hitsToKill(100, 0, 150)).toBe(1);
  });

  it("returns 2 when min damage doesn't one-shot but 2x does", () => {
    expect(hitsToKill(100, 0, 60)).toBe(2); // 60 < 100 but 120 >= 100
    expect(hitsToKill(100, 0, 51)).toBe(2);
  });

  it("falls back to ceil(effectiveHP / dmgMin) beyond 2 hits", () => {
    expect(hitsToKill(1000, 0, 60)).toBe(Math.ceil(1000 / 60));
    expect(hitsToKill(301, 0, 100)).toBe(4); // 100*3=300 < 301, needs a 4th hit
  });

  it("includes M.DEF in the effective HP pool", () => {
    expect(hitsToKill(50, 50, 100)).toBe(1); // eh=100, one-shot
    expect(hitsToKill(50, 51, 100)).toBe(2); // eh=101, no longer one-shot
  });

  it("boundary: dmgMin exactly equal to effective HP is a one-shot", () => {
    expect(hitsToKill(100, 0, 100)).toBe(1);
  });
});

describe("healDmg", () => {
  it("returns all-zero when Heal is not learned (level 0)", () => {
    expect(healDmg(0, 100, 20, 20)).toEqual({ min: 0, max: 0, mpCost: 0 });
  });

  it("matches the reference computation for level 10", () => {
    const d = healDmg(10, 100, 20, 20);
    expect(d.min).toBeCloseTo(58.5, 6);
    expect(d.max).toBeCloseTo(163.8, 6);
    expect(d.mpCost).toBe(39);
  });

  it("mpCost is always 29 + level", () => {
    for (const lvl of [1, 5, 15, 30]) {
      expect(healDmg(lvl, 100, 20, 20).mpCost).toBe(29 + lvl);
    }
  });

  it("uses a fixed 6.5x target multiplier regardless of caller-provided target count", () => {
    // healDmg no longer takes a numTargets param at all -- HEAL_TARGET_MULT is a
    // module constant fixed at 1.5 + 5/1 (solo play, no party mechanics).
    expect(HEAL_TARGET_MULT).toBeCloseTo(6.5, 10);
  });

  it("damage scales up with INT, LUK, and weapon M.ATT", () => {
    const base = healDmg(10, 100, 20, 20);
    expect(healDmg(10, 200, 20, 20).min).toBeGreaterThan(base.min);
    expect(healDmg(10, 100, 40, 20).min).toBeGreaterThan(base.min);
    expect(healDmg(10, 100, 20, 40).min).toBeGreaterThan(base.min);
  });
});

describe("healCastsToKill", () => {
  it("returns null when Heal is not learned", () => {
    expect(healCastsToKill(100, 0, 0, 100, 20, 20)).toBeNull();
  });

  it("returns the ceiling of effectiveHP / min heal damage", () => {
    const { min } = healDmg(10, 100, 20, 20);
    const eh = 500;
    expect(healCastsToKill(500, 0, 10, 100, 20, 20)).toBe(Math.ceil(eh / min));
  });

  it("one cast suffices when heal damage exceeds effective HP", () => {
    expect(healCastsToKill(1, 0, 30, 999, 999, 999)).toBe(1);
  });
});

describe("oneshotLevel", () => {
  const base = { level: 20, int: 87, luk: 23, weaponAtk: 21, mpMax: 571 };
  const magician = AP_DISTRIBUTIONS.magician;
  const mcDmg = stats => calcDmg(stats.weaponAtk, stats.int);

  it("returns null when even level-80 stats can't one-shot the target", () => {
    expect(oneshotLevel(999999999, 0, base, magician, mcDmg, MC_HITS_PER_CAST)).toBeNull();
  });

  it("returns the caller's own level when already strong enough to one-shot", () => {
    expect(oneshotLevel(1, 0, base, magician, mcDmg, MC_HITS_PER_CAST)).toBe(base.level);
  });

  it("returns a level within [baseChar.level, 80] when found", () => {
    // weaponAtk never scales with level in statsAtLevel (only INT/LUK do), so the
    // max possible min*2 at level 80 for this base char is ~955 -- pick a target
    // comfortably inside that range rather than an arbitrarily large one.
    const lvl = oneshotLevel(800, 0, base, magician, mcDmg, MC_HITS_PER_CAST);
    expect(lvl).not.toBeNull();
    expect(lvl).toBeGreaterThanOrEqual(base.level);
    expect(lvl).toBeLessThanOrEqual(80);
  });

  it("returns null when the target is unreachable even at level 80 (gear-independent cap)", () => {
    expect(oneshotLevel(50000, 0, base, magician, mcDmg, MC_HITS_PER_CAST)).toBeNull();
  });

  it("the returned level actually one-shots (sanity-checks its own answer)", () => {
    const hp = 800, mdef = 0;
    const lvl = oneshotLevel(hp, mdef, base, magician, mcDmg, MC_HITS_PER_CAST);
    const s = statsAtLevel(lvl, base, magician);
    const d = calcDmg(s.weaponAtk, s.int);
    expect(d.min * MC_HITS_PER_CAST).toBeGreaterThanOrEqual(hp + mdef);
    // and the level just before it should NOT one-shot (tightest possible answer)
    if (lvl > base.level) {
      const sPrev = statsAtLevel(lvl - 1, base, magician);
      const dPrev = calcDmg(sPrev.weaponAtk, sPrev.int);
      expect(dPrev.min * MC_HITS_PER_CAST).toBeLessThan(hp + mdef);
    }
  });
});

describe("MP Eater", () => {
  it("mpEaterAbsorbPerProc absorbs level/2 % of mob MP", () => {
    expect(mpEaterAbsorbPerProc(20, 100)).toBe(10); // 20/200 * 100 = 10 = 10%
    expect(mpEaterAbsorbPerProc(0, 100)).toBe(0);
  });

  it("mpEaterProcChance is level% per hit", () => {
    expect(mpEaterProcChance(20)).toBeCloseTo(0.2, 10);
    expect(mpEaterProcChance(1)).toBeCloseTo(0.01, 10);
  });

  it("mpEaterExpectedReturn is 0 when MP Eater isn't leveled or the mob has 0 MP", () => {
    expect(mpEaterExpectedReturn(0, 100, 2)).toBe(0);
    expect(mpEaterExpectedReturn(20, 0, 2)).toBe(0);
  });

  it("mpEaterExpectedReturn matches the reference computation", () => {
    expect(mpEaterExpectedReturn(20, 100, 2)).toBeCloseTo(4, 10);
  });

  it("mpEaterExpectedReturn scales linearly with number of hits", () => {
    const one = mpEaterExpectedReturn(20, 100, 1);
    const four = mpEaterExpectedReturn(20, 100, 4);
    expect(four).toBeCloseTo(one * 4, 10);
  });

  it("mpEaterAnyProcChance is 0 when MP Eater isn't leveled", () => {
    expect(mpEaterAnyProcChance(0, 5)).toBe(0);
  });

  it("mpEaterAnyProcChance matches the reference computation (1 - (1-p)^n)", () => {
    expect(mpEaterAnyProcChance(20, 2)).toBeCloseTo(0.36, 10);
  });

  it("mpEaterAnyProcChance increases (but stays < 1) as hits increase", () => {
    const few = mpEaterAnyProcChance(20, 2);
    const many = mpEaterAnyProcChance(20, 20);
    expect(many).toBeGreaterThan(few);
    expect(many).toBeLessThan(1);
  });
});

describe("netMpCost", () => {
  it("subtracts the MP Eater return from base cost", () => {
    expect(netMpCost(100, 30)).toBe(70);
  });

  it("never goes negative -- clamps at 0", () => {
    expect(netMpCost(20, 100)).toBe(0);
  });

  it("returns the base cost unchanged when there's no MP Eater return", () => {
    expect(netMpCost(50, 0)).toBe(50);
  });
});

describe("calcLevelsGained", () => {
  it("gains exactly one level when totalExp matches EXP_TABLE exactly (starting at 0%)", () => {
    const needed = EXP_TABLE[1]; // exp to go from level 1 to 2
    const r = calcLevelsGained(needed, 1, 0);
    expect(r.levelsGained).toBe(1);
    expect(r.finalLevel).toBe(2);
    expect(r.leftoverPct).toBeCloseTo(0, 6);
  });

  it("gains zero levels when totalExp doesn't clear the current level", () => {
    const needed = EXP_TABLE[1];
    const r = calcLevelsGained(needed / 2, 1, 0);
    expect(r.levelsGained).toBe(0);
    expect(r.finalLevel).toBe(1);
    expect(r.leftoverPct).toBeCloseTo(50, 0);
  });

  it("gains multiple levels when totalExp spans several EXP_TABLE entries", () => {
    const twoLevels = EXP_TABLE[1] + EXP_TABLE[2];
    const r = calcLevelsGained(twoLevels, 1, 0);
    expect(r.levelsGained).toBe(2);
    expect(r.finalLevel).toBe(3);
    expect(r.leftoverPct).toBeCloseTo(0, 6);
  });

  it("accounts for starting exp% already earned this level", () => {
    const needed = EXP_TABLE[1];
    const startExpEarned = Math.floor(needed * 0.5); // matches calcLevelsGained's own rounding
    const firstLvlRemaining = needed - startExpEarned;
    // Starting at 50% into level 1, only the remaining exp is needed to level up
    const r = calcLevelsGained(firstLvlRemaining, 1, 50);
    expect(r.levelsGained).toBe(1);
    expect(r.finalLevel).toBe(2);
  });

  it("starting exp% + gained exp that doesn't clear the level reports correct leftover%", () => {
    const needed = EXP_TABLE[1];
    const r = calcLevelsGained(needed * 0.1, 1, 20);
    expect(r.levelsGained).toBe(0);
    expect(r.leftoverPct).toBeCloseTo(30, 0); // 20% + 10% of the level's exp
  });

  it("totalExpGained of 0 never gains a level", () => {
    const r = calcLevelsGained(0, 5, 0);
    expect(r.levelsGained).toBe(0);
    expect(r.finalLevel).toBe(5);
    expect(r.leftoverPct).toBe(0);
  });
});

describe("MOB_INCOME_PER_KILL / incomePerKillFor", () => {
  it("returns the exact per-monster value when the monster is in the drop table", () => {
    const [knownId, knownValue] = Object.entries(MOB_INCOME_PER_KILL)[0];
    expect(incomePerKillFor(Number(knownId))).toBe(knownValue);
  });

  it("falls back to the dataset-wide average for unknown monster ids", () => {
    expect(incomePerKillFor(-999999)).toBe(FALLBACK_INCOME_PER_KILL);
  });

  it("FALLBACK_INCOME_PER_KILL is a positive finite number", () => {
    expect(FALLBACK_INCOME_PER_KILL).toBeGreaterThan(0);
    expect(Number.isFinite(FALLBACK_INCOME_PER_KILL)).toBe(true);
  });
});

describe("sessionProfit", () => {
  it("computes more casts for a longer session, proportionally", () => {
    const short = sessionProfit(30, MC_CAST_TIME_SEC, 1, 10, 100, 20, 0, "bluePotion", 500, 300);
    const long = sessionProfit(60, MC_CAST_TIME_SEC, 1, 10, 100, 20, 0, "bluePotion", 500, 300);
    expect(long.casts).toBeCloseTo(short.casts * 2, -1); // within rounding
    expect(long.kills).toBeCloseTo(short.kills * 2, -1);
  });

  it("uses MC_CAST_TIME_SEC for mc and HEAL_CAST_TIME_SEC for heal (different cast counts for the same duration)", () => {
    const mc = sessionProfit(60, MC_CAST_TIME_SEC, 1, 0, 100, 20, 0, "bluePotion", 500, 0);
    const heal = sessionProfit(60, HEAL_CAST_TIME_SEC, 1, 0, 100, 20, 0, "bluePotion", 500, 0);
    expect(mc.casts).toBe(Math.round((60 * 60) / MC_CAST_TIME_SEC));
    expect(heal.casts).toBe(Math.round((60 * 60) / HEAL_CAST_TIME_SEC));
  });

  it("profit = income - potion cost", () => {
    const r = sessionProfit(60, MC_CAST_TIME_SEC, 1, 10, 100, 20, 0, "bluePotion", 500, 300);
    expect(r.profit).toBe(r.income - r.potCost);
  });

  it("zero net MP cost per cast means zero potions consumed", () => {
    const r = sessionProfit(60, MC_CAST_TIME_SEC, 1, 0, 100, 20, 0, "bluePotion", 500, 300);
    expect(r.potCost).toBe(0);
    expect(r.profit).toBe(r.income);
  });

  it("falls back to Blue Potion for an unknown potion key", () => {
    const known = sessionProfit(60, MC_CAST_TIME_SEC, 1, 10, 100, 20, 0, "bluePotion", 500, 300);
    const unknown = sessionProfit(60, MC_CAST_TIME_SEC, 1, 10, 100, 20, 0, "totally-not-a-potion", 500, 300);
    expect(unknown).toEqual(known);
  });

  it("percentage-based potions (Elixir/Power Elixir) scale MP-per-potion with charMpMax", () => {
    const lowMp = sessionProfit(60, MC_CAST_TIME_SEC, 1, 100, 100, 20, 0, "elixir", 1000, 0);
    const highMp = sessionProfit(60, MC_CAST_TIME_SEC, 1, 100, 100, 20, 0, "elixir", 4000, 0);
    // more max MP -> more MP recovered per Elixir -> fewer potions needed -> lower cost
    expect(highMp.potCost).toBeLessThan(lowMp.potCost);
  });

  it("computes totalExp as kills * expPerKill * EXP_MULTI", () => {
    const r = sessionProfit(60, MC_CAST_TIME_SEC, 1, 0, 100, 20, 0, "bluePotion", 500, 0);
    expect(r.totalExp).toBe(Math.round(r.kills * 100 * EXP_MULTI));
  });

  it("every POTIONS entry has either a flat MP value or a percentage, never both/neither", () => {
    for (const potion of Object.values(POTIONS)) {
      const hasFlat = potion.mpFlat != null;
      const hasPct = potion.mpPct != null;
      expect(hasFlat).not.toBe(hasPct);
    }
  });
});

// v62 pre-BB physical damage formula, sourced from VoidMS's MapleCharacter.java
// (calculateMaxBaseDamage/calculateMinBaseDamage) and MapleWeaponType.java -- see
// formulas.js header comment above physicalBaseDamage for the full citation.
describe("physicalBaseDamage", () => {
  it("matches VoidMS's calculateMaxBaseDamage/calculateMinBaseDamage for a 1H Sword", () => {
    // str=100, dex=20, watk=100, 1H Sword multiplier=4.0, unlearned mastery (0.1)
    const { min, max } = physicalBaseDamage(WEAPON_MULTIPLIERS.sword1h, 100, 20, 100);
    expect(max).toBeCloseTo(((4.0 * 100 + 20) / 100) * 100 + 10, 10);
    expect(min).toBeCloseTo(((100 * 0.9 * 4.0 * 0.1 + 20) / 100) * 100, 10);
  });

  it("applies the +15 ranged watk bonus to min damage only, when given", () => {
    const noBonus = physicalBaseDamage(WEAPON_MULTIPLIERS.bow, 100, 20, 100);
    const withBonus = physicalBaseDamage(WEAPON_MULTIPLIERS.bow, 100, 20, 100, 15);
    expect(withBonus.max).toBe(noBonus.max);
    expect(withBonus.min).toBeGreaterThan(noBonus.min);
  });

  it("higher weapon attack strictly increases both min and max", () => {
    const low = physicalBaseDamage(WEAPON_MULTIPLIERS.sword1h, 100, 20, 50);
    const high = physicalBaseDamage(WEAPON_MULTIPLIERS.sword1h, 100, 20, 150);
    expect(high.min).toBeGreaterThan(low.min);
    expect(high.max).toBeGreaterThan(low.max);
  });
});

describe("physicalSkillDamage", () => {
  it("scales base damage linearly by skillPct", () => {
    const base = physicalBaseDamage(WEAPON_MULTIPLIERS.sword1h, 100, 20, 100);
    const skill = physicalSkillDamage(WEAPON_MULTIPLIERS.sword1h, 100, 20, 100, 260);
    expect(skill.max).toBeCloseTo(base.max * 2.6, 10);
    expect(skill.min).toBeCloseTo(base.min * 2.6, 10);
  });
});

// Skill-level constants below (damage%, MP cost) are lifted directly from a v62
// Skill.wz dump's per-level tables -- see classSkills.js header comment for sourcing.
describe("physical class skills (classSkills.js)", () => {
  const stats = { level: 20, str: 100, dex: 20, luk: 4, int: 4, weaponAtk: 100, mpMax: 100 };

  it("all five physical skills are verified with a real formula", () => {
    for (const key of ["powerStrike", "slashBlast", "doubleShot", "luckySeven", "somersaultKick"]) {
      expect(SKILLS[key].verified).toBe(true);
      expect(typeof SKILLS[key].formula).toBe("function");
      const d = SKILLS[key].formula(stats);
      expect(d.max).toBeGreaterThan(d.min);
      expect(d.min).toBeGreaterThan(0);
    }
  });

  it("Power Strike Lv20 is 260% weapon damage, 12 MP", () => {
    expect(SKILLS.powerStrike.mpCost()).toBe(12);
    const expected = physicalSkillDamage(WEAPON_MULTIPLIERS.sword1h, stats.str, stats.dex, stats.weaponAtk, 260);
    expect(SKILLS.powerStrike.formula(stats)).toEqual(expected);
  });

  it("Slash Blast Lv20 is 130% weapon damage, 14 MP, 6 mob AoE", () => {
    expect(SKILLS.slashBlast.mpCost()).toBe(14);
    expect(SKILLS.slashBlast.mobCount).toBe(6);
    const expected = physicalSkillDamage(WEAPON_MULTIPLIERS.sword1h, stats.str, stats.dex, stats.weaponAtk, 130);
    expect(SKILLS.slashBlast.formula(stats)).toEqual(expected);
  });

  it("Double Shot Lv20 is 130% weapon damage x2 bullets, 16 MP", () => {
    expect(SKILLS.doubleShot.mpCost()).toBe(16);
    expect(SKILLS.doubleShot.hitsPerCast).toBe(2);
    const expected = physicalSkillDamage(WEAPON_MULTIPLIERS.bow, stats.dex, stats.str, stats.weaponAtk, 130, 15);
    expect(SKILLS.doubleShot.formula(stats)).toEqual(expected);
  });

  it("Lucky Seven Lv20 is 150% weapon damage x2 bullets, 16 MP", () => {
    expect(SKILLS.luckySeven.mpCost()).toBe(16);
    expect(SKILLS.luckySeven.hitsPerCast).toBe(2);
    const expected = physicalSkillDamage(WEAPON_MULTIPLIERS.claw, stats.luk, stats.str + stats.dex, stats.weaponAtk, 150, 15);
    expect(SKILLS.luckySeven.formula(stats)).toEqual(expected);
  });

  it("Somersault Kick Lv20 is 190% weapon damage, 16 MP, 6 mob AoE", () => {
    expect(SKILLS.somersaultKick.mpCost()).toBe(16);
    expect(SKILLS.somersaultKick.mobCount).toBe(6);
    const expected = physicalSkillDamage(WEAPON_MULTIPLIERS.knuckle, stats.str, stats.dex, stats.weaponAtk, 190);
    expect(SKILLS.somersaultKick.formula(stats)).toEqual(expected);
  });
});

// 2nd-job physical skills -- see classSkills.js header comment for sourcing/naming
// confidence caveats. All damage%/MP/mobCount values are wz-exact regardless of
// display-name confidence.
describe("2nd job physical class skills (classSkills.js)", () => {
  const stats = { level: 20, str: 100, dex: 20, luk: 4, int: 4, weaponAtk: 100, mpMax: 100 };
  const secondJobKeys = ["arrowBomb", "crossbowmanAoe", "drain", "savageBlow", "backspinBlow", "doubleUppercut", "corkscrewBlow", "grenade", "blankShot"];

  it("are all verified with a real formula", () => {
    for (const key of secondJobKeys) {
      expect(SKILLS[key].verified).toBe(true);
      const d = SKILLS[key].formula(stats);
      expect(d.max).toBeGreaterThan(d.min);
      expect(d.min).toBeGreaterThan(0);
    }
  });

  it("Arrow Bomb Lv20 is 200% weapon damage, 15 MP, 6 mob AoE", () => {
    expect(SKILLS.arrowBomb.mpCost()).toBe(15);
    expect(SKILLS.arrowBomb.mobCount).toBe(6);
    const expected = physicalSkillDamage(WEAPON_MULTIPLIERS.bow, stats.dex, stats.str, stats.weaponAtk, 200, 15);
    expect(SKILLS.arrowBomb.formula(stats)).toEqual(expected);
  });

  it("Crossbowman's AoE mirrors Arrow Bomb's numbers on crossbow", () => {
    expect(SKILLS.crossbowmanAoe.mpCost()).toBe(15);
    expect(SKILLS.crossbowmanAoe.mobCount).toBe(6);
    const expected = physicalSkillDamage(WEAPON_MULTIPLIERS.crossbow, stats.dex, stats.str, stats.weaponAtk, 200, 15);
    expect(SKILLS.crossbowmanAoe.formula(stats)).toEqual(expected);
  });

  it("Drain Lv30 is 160% weapon damage, 24 MP", () => {
    expect(SKILLS.drain.mpCost()).toBe(24);
    const expected = physicalSkillDamage(WEAPON_MULTIPLIERS.claw, stats.luk, stats.str + stats.dex, stats.weaponAtk, 160, 15);
    expect(SKILLS.drain.formula(stats)).toEqual(expected);
  });

  it("Savage Blow Lv30 is 80% weapon damage, 27 MP", () => {
    expect(SKILLS.savageBlow.mpCost()).toBe(27);
    const expected = physicalSkillDamage(WEAPON_MULTIPLIERS.claw, stats.luk, stats.str + stats.dex, stats.weaponAtk, 80, 15);
    expect(SKILLS.savageBlow.formula(stats)).toEqual(expected);
  });

  it("Brawler's 3 skills (Backspin Blow, Double Uppercut, Corkscrew Blow) match their wz values", () => {
    expect(SKILLS.backspinBlow.mpCost()).toBe(30);
    expect(SKILLS.backspinBlow.mobCount).toBe(3);
    expect(SKILLS.backspinBlow.formula(stats)).toEqual(physicalSkillDamage(WEAPON_MULTIPLIERS.knuckle, stats.str, stats.dex, stats.weaponAtk, 240));

    expect(SKILLS.doubleUppercut.mpCost()).toBe(30);
    expect(SKILLS.doubleUppercut.mobCount).toBeUndefined();
    expect(SKILLS.doubleUppercut.formula(stats)).toEqual(physicalSkillDamage(WEAPON_MULTIPLIERS.knuckle, stats.str, stats.dex, stats.weaponAtk, 290));

    expect(SKILLS.corkscrewBlow.mpCost()).toBe(36);
    expect(SKILLS.corkscrewBlow.mobCount).toBe(3);
    expect(SKILLS.corkscrewBlow.formula(stats)).toEqual(physicalSkillDamage(WEAPON_MULTIPLIERS.knuckle, stats.str, stats.dex, stats.weaponAtk, 420));
  });

  it("Gunslinger's Grenade and Blank Shot match their wz values", () => {
    expect(SKILLS.grenade.mpCost()).toBe(25);
    expect(SKILLS.grenade.mobCount).toBe(3);
    expect(SKILLS.grenade.formula(stats)).toEqual(physicalSkillDamage(WEAPON_MULTIPLIERS.gun, stats.dex, stats.str, stats.weaponAtk, 170));

    expect(SKILLS.blankShot.mpCost()).toBe(25);
    expect(SKILLS.blankShot.mobCount).toBe(3);
    expect(SKILLS.blankShot.formula(stats)).toEqual(physicalSkillDamage(WEAPON_MULTIPLIERS.gun, stats.dex, stats.str, stats.weaponAtk, 120));
  });
});

// FP/IL Wizard's elemental spells -- intentionally NOT verified yet (see classSkills.js
// header comment). These tests lock in the "still unverified, raw data preserved"
// state itself, so a future formula fix has to deliberately update this test too.
// Magic Claw's own Skill.wz entry (mad=40, mastery=10 at its max level) is the
// calibration reference for magicSkillDamage -- see formulas.js header comment.
describe("magicSkillDamage", () => {
  it("reproduces calcDmg exactly when given Magic Claw's own mad=40/mastery=10", () => {
    const cases = [[21, 87], [100, 200], [0, 50]];
    for (const [matk, int_] of cases) {
      expect(magicSkillDamage(matk, int_, 40, 10)).toEqual(calcDmg(matk, int_));
    }
  });

  it("higher spellAtk (mad) strictly increases both min and max", () => {
    const low = magicSkillDamage(50, 100, 60, 10);
    const high = magicSkillDamage(50, 100, 120, 10);
    expect(high.min).toBeGreaterThan(low.min);
    expect(high.max).toBeGreaterThan(low.max);
  });

  it("higher masteryField increases min but leaves max unchanged", () => {
    const low = magicSkillDamage(50, 100, 80, 1);
    const high = magicSkillDamage(50, 100, 80, 10);
    expect(high.min).toBeGreaterThan(low.min);
    expect(high.max).toBe(low.max);
  });
});

describe("elementalMultiplier / scaleDamage", () => {
  const weak = { weak: "Fire", strong: "-", immune: "-" };
  const immune = { weak: "-", strong: "-", immune: "Fire" };
  const strong = { weak: "-", strong: "Fire", immune: "-" };
  const neutral = { weak: "-", strong: "-", immune: "-" };
  const combo = { weak: "Holy/Fire", strong: "-", immune: "-" };

  it("returns 1x (normal) for a non-elemental skill regardless of monster tags", () => {
    expect(elementalMultiplier(null, weak)).toBe(ELEMENTAL_MULTIPLIER.normal);
    expect(elementalMultiplier(undefined, immune)).toBe(ELEMENTAL_MULTIPLIER.normal);
  });

  it("matches weak/strong/immune/normal for a matching element, case-insensitively", () => {
    expect(elementalMultiplier("fire", weak)).toBe(ELEMENTAL_MULTIPLIER.weak);
    expect(elementalMultiplier("Fire", weak)).toBe(ELEMENTAL_MULTIPLIER.weak);
    expect(elementalMultiplier("fire", immune)).toBe(ELEMENTAL_MULTIPLIER.immune);
    expect(elementalMultiplier("fire", strong)).toBe(ELEMENTAL_MULTIPLIER.strong);
    expect(elementalMultiplier("fire", neutral)).toBe(ELEMENTAL_MULTIPLIER.normal);
  });

  it("matches a combo weak field like 'Holy/Fire'", () => {
    expect(elementalMultiplier("fire", combo)).toBe(ELEMENTAL_MULTIPLIER.weak);
    expect(elementalMultiplier("holy", combo)).toBe(ELEMENTAL_MULTIPLIER.weak);
    expect(elementalMultiplier("ice", combo)).toBe(ELEMENTAL_MULTIPLIER.normal);
  });

  it("immune takes priority even if also (implausibly) tagged weak", () => {
    expect(elementalMultiplier("fire", { weak: "Fire", strong: "-", immune: "Fire" })).toBe(ELEMENTAL_MULTIPLIER.immune);
  });

  it("scaleDamage scales min and max by the same factor", () => {
    const d = { min: 10, max: 20 };
    expect(scaleDamage(d, 1.5)).toEqual({ min: 15, max: 30 });
    expect(scaleDamage(d, 0)).toEqual({ min: 0, max: 0 });
  });
});

describe("elemental magic skills (classSkills.js)", () => {
  const stats = { level: 30, str: 4, dex: 4, luk: 4, int: 100, weaponAtk: 50, mpMax: 200 };

  it("Fire Arrow, Poison Breath, Cold Beam, and Thunder Bolt are all verified", () => {
    for (const key of ["fireArrow", "poisonBreath", "coldBeam", "thunderBolt"]) {
      expect(SKILLS[key].verified).toBe(true);
      const d = SKILLS[key].formula(stats);
      expect(d.max).toBeGreaterThan(d.min);
      expect(d.min).toBeGreaterThan(0);
    }
  });

  it("Fire/Poison are tagged to FP Wizard, Cold/Thunder to IL Wizard, with the right elements", () => {
    expect(SKILLS.fireArrow.job).toContain("FP Wizard");
    expect(SKILLS.poisonBreath.job).toContain("FP Wizard");
    expect(SKILLS.coldBeam.job).toContain("IL Wizard");
    expect(SKILLS.thunderBolt.job).toContain("IL Wizard");
    expect(SKILLS.fireArrow.element).toBe("fire");
    expect(SKILLS.poisonBreath.element).toBe("poison");
    expect(SKILLS.coldBeam.element).toBe("ice");
    expect(SKILLS.thunderBolt.element).toBe("lightning");
  });

  it("Fire Arrow Lv30 (mad=120) matches magicSkillDamage directly", () => {
    expect(SKILLS.fireArrow.mpCost()).toBe(28);
    expect(SKILLS.fireArrow.formula(stats)).toEqual(magicSkillDamage(stats.weaponAtk, stats.int, 120, 10));
  });

  it("Thunder Bolt Lv30 (mad=60) is a 6-mob AoE", () => {
    expect(SKILLS.thunderBolt.mpCost()).toBe(40);
    expect(SKILLS.thunderBolt.mobCount).toBe(6);
    expect(SKILLS.thunderBolt.formula(stats)).toEqual(magicSkillDamage(stats.weaponAtk, stats.int, 60, 10));
  });
});

// Incoming damage / HP potion usage -- see formulas.js's incomingDamagePerHit
// header comment for what is and isn't modeled (an estimate, not a sourced
// hit-chance/defense formula). HP_POTIONS prices are v62 Item.wz-sourced
// (ids 2000000/2000001/2000002), same as POTIONS' MP items.
describe("incomingDamagePerHit / hpLossPerSecond", () => {
  it("damage is mob wAtk minus player defense, floored at 1", () => {
    expect(incomingDamagePerHit(50, 20)).toBe(30);
    expect(incomingDamagePerHit(10, 20)).toBe(1); // never negative/zero
    expect(incomingDamagePerHit(50, 0)).toBe(50);
    expect(incomingDamagePerHit(50)).toBe(50); // playerDef defaults to 0
  });

  it("hpLossPerSecond divides per-hit damage by the hit interval", () => {
    expect(hpLossPerSecond(50, 20, 4)).toBeCloseTo(7.5, 10);
    expect(hpLossPerSecond(50, 20, 3)).toBeGreaterThan(hpLossPerSecond(50, 20, 5)); // shorter interval = more DPS
  });

  it("hpLossPerSecond is 0 when hitIntervalSec is falsy (avoids divide-by-zero)", () => {
    expect(hpLossPerSecond(50, 20, 0)).toBe(0);
  });
});

describe("HP_POTIONS", () => {
  it("every entry has a positive cost and hpFlat", () => {
    for (const p of Object.values(HP_POTIONS)) {
      expect(p.cost).toBeGreaterThan(0);
      expect(p.hpFlat).toBeGreaterThan(0);
    }
  });

  it("Red/Orange/White Potion match their sourced v62 Item.wz values", () => {
    expect(HP_POTIONS.redPotion).toMatchObject({ cost: 25, hpFlat: 50 });
    expect(HP_POTIONS.orangePotion).toMatchObject({ cost: 80, hpFlat: 150 });
    expect(HP_POTIONS.whitePotion).toMatchObject({ cost: 160, hpFlat: 300 });
  });
});

describe("isSuspiciousPotionPrice", () => {
  it("flags nothing in the real, sourced HP_POTIONS/POTIONS sets", () => {
    for (const p of Object.values(HP_POTIONS)) expect(isSuspiciousPotionPrice(p, "hp")).toBe(false);
    for (const p of Object.values(POTIONS)) expect(isSuspiciousPotionPrice(p, "mp")).toBe(false);
  });

  it("flags an implausibly cheap or expensive flat-restore potion", () => {
    expect(isSuspiciousPotionPrice({ cost: 1, hpFlat: 1000 }, "hp")).toBe(true); // way under 0.2 mesos/HP
    expect(isSuspiciousPotionPrice({ cost: 100000, hpFlat: 10 }, "hp")).toBe(true); // way over 2 mesos/HP
  });

  it("never flags a %-based potion (no fixed per-unit rate to check)", () => {
    expect(isSuspiciousPotionPrice({ cost: 999999, mpPct: 0.5 }, "mp")).toBe(false);
  });
});

describe("sessionProfit with HP potion params", () => {
  const base = [60, 2.0, 1, 5, 100, 20, 0, "bluePotion", 500, 50]; // minutes..incomePerKill, no HP params

  it("omitting HP params behaves exactly as before (hpPotCost=0, potCost=mpPotCost)", () => {
    const r = sessionProfit(...base);
    expect(r.hpPotCost).toBe(0);
    expect(r.hpPotsNeeded).toBe(0);
    expect(r.potCost).toBe(r.mpPotCost);
  });

  it("a positive hpLossPerSec adds hpPotCost on top of the unchanged mpPotCost", () => {
    const withoutHp = sessionProfit(...base);
    const withHp = sessionProfit(...base, 7.5, "orangePotion", 400);
    expect(withHp.mpPotCost).toBe(withoutHp.mpPotCost); // MP side is untouched
    expect(withHp.hpPotCost).toBeGreaterThan(0);
    expect(withHp.potCost).toBe(withHp.mpPotCost + withHp.hpPotCost);
    expect(withHp.profit).toBeLessThan(withoutHp.profit); // extra cost eats into profit
  });

  it("falls back to Orange Potion for an unknown hpPotionKey", () => {
    const known = sessionProfit(...base, 7.5, "orangePotion", 400);
    const unknown = sessionProfit(...base, 7.5, "not-a-real-potion", 400);
    expect(unknown).toEqual(known);
  });

  it("extraMpLossPerSec (Magic Guard) adds mpPotCost without touching hpPotCost", () => {
    const withoutMg = sessionProfit(...base, 7.5, "orangePotion", 400);
    const withMg = sessionProfit(...base, 7.5, "orangePotion", 400, 3);
    expect(withMg.hpPotCost).toBe(withoutMg.hpPotCost); // HP side untouched by this param
    expect(withMg.mpPotCost).toBeGreaterThan(withoutMg.mpPotCost);
    expect(withMg.potCost).toBe(withMg.mpPotCost + withMg.hpPotCost);
  });
});

// Magic Guard -- v62 Skill.wz id 2001003, Magician 1st job (any branch).
// Converts a % of incoming damage into MP loss instead of HP loss.
describe("magicGuardPct", () => {
  it("is exactly level*2, capping at 40% (the real Lv20 max)", () => {
    expect(magicGuardPct(1)).toBe(2);
    expect(magicGuardPct(10)).toBe(20);
    expect(magicGuardPct(20)).toBe(40);
  });

  it("is 0 when unlearned", () => {
    expect(magicGuardPct(0)).toBe(0);
  });
});

describe("MAGIC_GUARD_LEVELS", () => {
  it("has an entry for every level 1-20 with a positive mpCon and duration", () => {
    for (let lvl = 1; lvl <= 20; lvl++) {
      const e = MAGIC_GUARD_LEVELS[lvl];
      expect(e).toBeTruthy();
      expect(e.mpCon).toBeGreaterThan(0);
      expect(e.duration).toBeGreaterThan(0);
    }
  });

  it("matches the sourced Lv1/Lv20 wz values exactly", () => {
    expect(MAGIC_GUARD_LEVELS[1]).toEqual({ mpCon: 8, duration: 54 });
    expect(MAGIC_GUARD_LEVELS[20]).toEqual({ mpCon: 16, duration: 400 });
  });
});

describe("applyMagicGuard", () => {
  it("does nothing (passes hpLossPerSec through, no extra MP) when Magic Guard is unlearned", () => {
    const r = applyMagicGuard(10, 0);
    expect(r.hpLossPerSec).toBe(10);
    expect(r.extraMpLossPerSec).toBe(0);
  });

  it("does nothing when there's no incoming damage to begin with", () => {
    const r = applyMagicGuard(0, 20);
    expect(r.hpLossPerSec).toBe(0);
    expect(r.extraMpLossPerSec).toBe(0);
  });

  it("converts exactly pct% of hpLossPerSec to extraMpLossPerSec at Lv20 (40%)", () => {
    const r = applyMagicGuard(10, 20);
    expect(r.hpLossPerSec).toBeCloseTo(6, 10); // 60% remains as HP loss
    // extraMpLossPerSec = converted damage (4) + amortized recast cost (16/400 = 0.04)
    expect(r.extraMpLossPerSec).toBeCloseTo(4 + 16 / 400, 10);
  });

  it("reduces HP loss and increases MP loss monotonically with level", () => {
    const lv10 = applyMagicGuard(10, 10);
    const lv20 = applyMagicGuard(10, 20);
    expect(lv20.hpLossPerSec).toBeLessThan(lv10.hpLossPerSec);
    expect(lv20.extraMpLossPerSec).toBeGreaterThan(lv10.extraMpLossPerSec);
  });

  it("hpLossPerSec + (extraMpLossPerSec minus the recast-cost component) accounts for all original damage", () => {
    // sanity check: the damage-conversion portion alone (excluding the separate
    // recast-cost drain) should exactly complement the remaining HP loss
    const hpLossPerSec = 10, lvl = 15;
    const r = applyMagicGuard(hpLossPerSec, lvl);
    const recastPerSec = MAGIC_GUARD_LEVELS[lvl].mpCon / MAGIC_GUARD_LEVELS[lvl].duration;
    const convertedDamage = r.extraMpLossPerSec - recastPerSec;
    expect(r.hpLossPerSec + convertedDamage).toBeCloseTo(hpLossPerSec, 10);
  });
});
