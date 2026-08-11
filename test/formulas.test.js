import { describe, it, expect } from "vitest";
import {
  DEFAULT_CHAR, INT_PER_LEVEL, LUK_PER_LEVEL, statsAtLevel,
  EXP_MULTI, MC_HITS_PER_CAST, calcDmg, hitsToKill,
  HEAL_TARGET_MULT, healDmg, healCastsToKill, oneshotLevel,
  mpEaterAbsorbPerProc, mpEaterProcChance, mpEaterExpectedReturn, mpEaterAnyProcChance, netMpCost,
  calcLevelsGained, FALLBACK_INCOME_PER_KILL, incomePerKillFor,
  MC_CAST_TIME_SEC, HEAL_CAST_TIME_SEC, POTIONS, sessionProfit,
} from "../src/lib/formulas";
import { EXP_TABLE } from "../src/data/expTable";
import { MOB_INCOME_PER_KILL } from "../src/data/mobDrops";

describe("statsAtLevel", () => {
  const base = { level: 20, int: 87, luk: 23, weaponMatk: 21, mpMax: 571 };

  it("returns the base stats unchanged at the base level", () => {
    const s = statsAtLevel(20, base);
    expect(s).toEqual({ level: 20, int: 87, luk: 23, weaponMatk: 21, mpMax: 571 });
  });

  it("adds +4 INT / +1 LUK per level gained", () => {
    const s = statsAtLevel(21, base);
    expect(s.int).toBe(base.int + INT_PER_LEVEL);
    expect(s.luk).toBe(base.luk + LUK_PER_LEVEL);
  });

  it("matches the reference computation at level 25", () => {
    const s = statsAtLevel(25, base);
    expect(s).toEqual({ level: 25, int: 107, luk: 28, weaponMatk: 21, mpMax: 646 });
  });

  it("never changes weaponMatk (gear-driven, not level-driven)", () => {
    expect(statsAtLevel(40, base).weaponMatk).toBe(base.weaponMatk);
  });

  it("handles going down in level (negative g) symmetrically", () => {
    const up = statsAtLevel(25, base);
    const down = statsAtLevel(20, up);
    expect(down.int).toBe(base.int);
    expect(down.luk).toBe(base.luk);
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
  const base = { level: 20, int: 87, luk: 23, weaponMatk: 21, mpMax: 571 };

  it("returns null when even level-80 stats can't one-shot the target", () => {
    expect(oneshotLevel(999999999, 0, base)).toBeNull();
  });

  it("returns the caller's own level when already strong enough to one-shot", () => {
    expect(oneshotLevel(1, 0, base)).toBe(base.level);
  });

  it("returns a level within [baseChar.level, 80] when found", () => {
    // weaponMatk never scales with level in statsAtLevel (only INT/LUK do), so the
    // max possible min*2 at level 80 for this base char is ~955 -- pick a target
    // comfortably inside that range rather than an arbitrarily large one.
    const lvl = oneshotLevel(800, 0, base);
    expect(lvl).not.toBeNull();
    expect(lvl).toBeGreaterThanOrEqual(base.level);
    expect(lvl).toBeLessThanOrEqual(80);
  });

  it("returns null when the target is unreachable even at level 80 (gear-independent cap)", () => {
    expect(oneshotLevel(50000, 0, base)).toBeNull();
  });

  it("the returned level actually one-shots (sanity-checks its own answer)", () => {
    const hp = 800, mdef = 0;
    const lvl = oneshotLevel(hp, mdef, base);
    const s = statsAtLevel(lvl, base);
    const d = calcDmg(s.weaponMatk, s.int);
    expect(d.min * MC_HITS_PER_CAST).toBeGreaterThanOrEqual(hp + mdef);
    // and the level just before it should NOT one-shot (tightest possible answer)
    if (lvl > base.level) {
      const sPrev = statsAtLevel(lvl - 1, base);
      const dPrev = calcDmg(sPrev.weaponMatk, sPrev.int);
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
    const short = sessionProfit(30, "mc", 1, 10, 100, 20, 0, "bluePotion", 500, 300);
    const long = sessionProfit(60, "mc", 1, 10, 100, 20, 0, "bluePotion", 500, 300);
    expect(long.casts).toBeCloseTo(short.casts * 2, -1); // within rounding
    expect(long.kills).toBeCloseTo(short.kills * 2, -1);
  });

  it("uses MC_CAST_TIME_SEC for mc and HEAL_CAST_TIME_SEC for heal (different cast counts for the same duration)", () => {
    const mc = sessionProfit(60, "mc", 1, 0, 100, 20, 0, "bluePotion", 500, 0);
    const heal = sessionProfit(60, "heal", 1, 0, 100, 20, 0, "bluePotion", 500, 0);
    expect(mc.casts).toBe(Math.round((60 * 60) / MC_CAST_TIME_SEC));
    expect(heal.casts).toBe(Math.round((60 * 60) / HEAL_CAST_TIME_SEC));
  });

  it("profit = income - potion cost", () => {
    const r = sessionProfit(60, "mc", 1, 10, 100, 20, 0, "bluePotion", 500, 300);
    expect(r.profit).toBe(r.income - r.potCost);
  });

  it("zero net MP cost per cast means zero potions consumed", () => {
    const r = sessionProfit(60, "mc", 1, 0, 100, 20, 0, "bluePotion", 500, 300);
    expect(r.potCost).toBe(0);
    expect(r.profit).toBe(r.income);
  });

  it("falls back to Blue Potion for an unknown potion key", () => {
    const known = sessionProfit(60, "mc", 1, 10, 100, 20, 0, "bluePotion", 500, 300);
    const unknown = sessionProfit(60, "mc", 1, 10, 100, 20, 0, "totally-not-a-potion", 500, 300);
    expect(unknown).toEqual(known);
  });

  it("percentage-based potions (Elixir/Power Elixir) scale MP-per-potion with charMpMax", () => {
    const lowMp = sessionProfit(60, "mc", 1, 100, 100, 20, 0, "elixir", 1000, 0);
    const highMp = sessionProfit(60, "mc", 1, 100, 100, 20, 0, "elixir", 4000, 0);
    // more max MP -> more MP recovered per Elixir -> fewer potions needed -> lower cost
    expect(highMp.potCost).toBeLessThan(lowMp.potCost);
  });

  it("computes totalExp as kills * expPerKill * EXP_MULTI", () => {
    const r = sessionProfit(60, "mc", 1, 0, 100, 20, 0, "bluePotion", 500, 0);
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
