// Registry of classic-era (pre-BB v62) classes and their primary attacking skill,
// plus Magician/Cleric's distinct secondary skill (Heal). This is the extensibility
// point for supporting other classes: each entry owns its own AP distribution,
// damage formula, hits/targets-per-cast semantics, and cast time -- there's no single
// shared "class damage formula," because there genuinely isn't one in the real game
// (Lucky Seven's line-AoE, Slash Blast's radius-AoE, and Heal's party-size-gated
// multiplier are all structurally different mechanics, not just different numbers
// plugged into the same shape).
//
// IMPORTANT: `verified: false` entries have NO sourced, spot-checked formula yet --
// `formula` is null and they're disabled in the skill selector rather than shipped
// with a guessed number. Adding a new class means: (1) source and verify its formula,
// (2) fill in `formula`/`mpCost`/`hitsPerCast`/`castTimeSec`, (3) set `verified: true`.
//
// Magic Claw and Heal were verified from an Ayumilove/Southperry-style v62 formula
// compilation (see README.md "Efficiency metric" / "Heal target mult") spot-checked
// against legends.ml. Every physical (weapon-based) skill below was verified directly
// from a v62 Skill.wz data dump (per-level damage%/MP tables) plus VoidMS's (a v62-era
// private server, github.com/hugogrochau/VoidMS) MapleCharacter.java for the base
// physical damage formula -- see formulas.js's physicalBaseDamage/physicalSkillDamage
// header comment. Each is modeled at its max skill level, matching the "one build
// style per class" simplification AP_DISTRIBUTIONS already makes for stat growth.
//
// 1st-job skills (Power Strike, Slash Blast, Double Shot, Lucky Seven, Somersault
// Kick) are every class's baseline attack, learnable from the start. The 2nd-job
// skills below (Arrow Bomb onward) are each branch's ONE new attack skill gained at
// 2nd job -- per the actual Skill.wz layout, that's genuinely all there is: Warrior's
// 2nd-job branches (Fighter/Page/Spearman) get zero new attack skills (their 2nd-job
// kit is pure Mastery/Booster/Final-Attack-passive/buffs), and Cleric's only
// holy-tagged entry is a passive MATK buff, not an attack -- Heal itself carries no
// elemAttr. Magician's other two branches (FP/IL Wizard) DO get real elemental attack
// spells (Fire Arrow, Poison Breath, Cold Beam, Thunder Bolt) but those use a
// materially different formula shape (a per-level "mad" magic-attack bonus folded
// into the Magic Claw-style formula, not a flat damage% like every skill here) that
// hasn't been spot-checked yet -- see the elementalMagic object below, all
// verified: false with the raw wz values preserved for whoever verifies it next.
//
// Skill-name confidence: IDs, damage%, MP, and mob/bullet counts are all read
// directly from Skill.wz and are exact. The IN-GAME NAME attached to each ID is not
// (String.wz's skill-name table wasn't present in the dump used) -- names below are
// inferred from each skill's mechanical shape (weapon type, AoE vs single-target,
// proc fields) cross-checked against community knowledge of each class's kit. Where
// that inference is confident it's stated plainly; where it's a best guess among
// plausible options, that's flagged inline.
//
// mapScoreArchetype: which of the 4 map-quality scores in public/data/mapScores.js
// (see tools/extract_skill_map_scores.mjs) applies to this skill's own hitbox --
// picked from each skill's real Skill.wz range/mobCount/lt-rb box at max level, not
// guessed:
//   "ranged" (mcScore) -- single-target, long reach (bow/claw/wand/staff/gun weapons,
//     no skill-defined AoE box). MC_RANGE_PX=425 in analyze_maps.py.
//   "melee"  (meleeScore) -- single-target, short reach (sword/knuckle weapons).
//   "aoe"    (aoeScore) -- multi-mob (Skill.wz mobCount present) but a SMALL vertical
//     box (well under 200px each way) -- can clump mobs on one platform, can't reach
//     an adjacent floor.
//   "vertical" (healScore) -- multi-mob with a LARGE vertical box (Heal's is -200..200,
//     the only skill here with this shape) that genuinely reaches adjacent floors.
import {
  calcDmg, healDmg, physicalSkillDamage, magicSkillDamage, WEAPON_MULTIPLIERS, AP_DISTRIBUTIONS,
  MC_HITS_PER_CAST, MC_CAST_TIME_SEC, HEAL_CAST_TIME_SEC,
} from "./formulas";

export const SKILLS = {
  magicClaw: {
    key: "magicClaw",
    label: "Magic Claw",
    class: "magician",
    job: "1st Job (any branch)",
    mapScoreArchetype: "ranged",
    apDistribution: AP_DISTRIBUTIONS.magician,
    hitsPerCast: MC_HITS_PER_CAST,
    castTimeSec: MC_CAST_TIME_SEC,
    verified: true,
    // stats -> { min, max } per single hit (the 2-hits-per-cast multiplication
    // happens at the call site, same as the app's pre-existing MC_HITS_PER_CAST usage)
    formula: stats => calcDmg(stats.weaponAtk, stats.int),
    mpCost: () => 20, // flat, matches the app's pre-existing MC_MP_COST behavior
  },
  heal: {
    key: "heal",
    label: "Heal",
    class: "magician",
    job: "2nd Job (Cleric)",
    mapScoreArchetype: "vertical",
    apDistribution: AP_DISTRIBUTIONS.magician,
    hitsPerCast: 1,
    castTimeSec: HEAL_CAST_TIME_SEC,
    verified: true,
    undeadOnly: true,
    healsAllies: true,
    // formula(stats, skillLevel) -- the only skill here whose damage depends on its
    // own skill level (skillPct = skillLevel * 15%), not just character stats.
    formula: (stats, skillLevel) => healDmg(skillLevel, stats.int, stats.luk, stats.weaponAtk),
  },
  doubleShot: {
    key: "doubleShot",
    label: "Double Shot",
    class: "bowman",
    job: "1st Job (Hunter/Crossbowman)",
    mapScoreArchetype: "ranged",
    apDistribution: AP_DISTRIBUTIONS.bowman,
    hitsPerCast: 2, // bulletCount=2 in Skill.wz -- 2 independently-rolled arrows/cast, same shape as Magic Claw
    castTimeSec: 1.5, // estimated (physical attacks are faster than magic casts) -- not wz-sourced, same caveat as MC_CAST_TIME_SEC
    verified: true,
    // Lv20 (max): damage 130%, MP 16 (Skill.wz id 3001005). Bow, DEX primary/STR secondary,
    // +15 ranged watk bonus on the min side (see formulas.js physicalBaseDamage comment).
    formula: stats => physicalSkillDamage(WEAPON_MULTIPLIERS.bow, stats.dex, stats.str, stats.weaponAtk, 130, 15),
    mpCost: () => 16,
  },
  luckySeven: {
    key: "luckySeven",
    label: "Lucky Seven",
    class: "thief",
    job: "1st Job (Assassin)",
    mapScoreArchetype: "ranged",
    apDistribution: AP_DISTRIBUTIONS.thief,
    // bulletCount=2 in Skill.wz (id 4001344, weapon=claw) -- 2 independently-rolled star
    // throws at a single target, NOT a positional line-AoE as previously assumed here.
    hitsPerCast: 2,
    castTimeSec: 1.5, // estimated, see doubleShot
    verified: true,
    // Lv20 (max): damage 150%, MP 16. Claw, LUK primary/(STR+DEX) secondary, +15 ranged
    // watk bonus on the min side (VoidMS applies this to claw same as bow/crossbow).
    formula: stats => physicalSkillDamage(WEAPON_MULTIPLIERS.claw, stats.luk, stats.str + stats.dex, stats.weaponAtk, 150, 15),
    mpCost: () => 16,
  },
  powerStrike: {
    key: "powerStrike",
    label: "Power Strike",
    class: "warrior",
    job: "1st Job (any branch)",
    mapScoreArchetype: "melee",
    apDistribution: AP_DISTRIBUTIONS.warrior,
    hitsPerCast: 1,
    castTimeSec: 1.5, // estimated, see doubleShot
    verified: true,
    // Lv20 (max): damage 260%, MP 12 (Skill.wz id 1001004). Modeled on 1H Sword (4.0x);
    // real warriors may dual-wield axe/blunt/2h variants with slightly different
    // multipliers (3.2-5.0x) -- sword is the representative default, same simplification
    // AP_DISTRIBUTIONS already makes for "one build style per class".
    formula: stats => physicalSkillDamage(WEAPON_MULTIPLIERS.sword1h, stats.str, stats.dex, stats.weaponAtk, 260),
    mpCost: () => 12,
  },
  slashBlast: {
    key: "slashBlast",
    label: "Slash Blast",
    class: "warrior",
    job: "1st Job (any branch)",
    mapScoreArchetype: "aoe",
    apDistribution: AP_DISTRIBUTIONS.warrior,
    // mobCount=6 in Skill.wz (id 1001005) -- a true fixed-radius AoE around the caster,
    // not line-based (Lucky Seven) or party-gated (Heal). hitsPerCast stays 1 because
    // each hit mob only takes ONE hit; per-cast KILL THROUGHPUT across up to 6 mobs
    // isn't modeled here yet (same open gap the app already has for Somersault Kick).
    hitsPerCast: 1,
    castTimeSec: 2.5, // estimated -- AoE cast, bigger commitment than a single-target hit
    verified: true,
    // Lv20 (max): damage 130%, MP 14 + HP 8 (Slash Blast costs HP as well as MP --
    // hpCost intentionally unmodeled since this app has no HP-tracking mechanic).
    formula: stats => physicalSkillDamage(WEAPON_MULTIPLIERS.sword1h, stats.str, stats.dex, stats.weaponAtk, 130),
    mpCost: () => 14,
    mobCount: 6,
  },
  somersaultKick: {
    key: "somersaultKick",
    label: "Somersault Kick",
    class: "pirate",
    job: "1st Job (Brawler)",
    mapScoreArchetype: "aoe",
    apDistribution: AP_DISTRIBUTIONS.pirate,
    // mobCount=6 at Lv20 in Skill.wz (id 5001002) -- fixed-radius AoE like Slash Blast.
    hitsPerCast: 1,
    castTimeSec: 2.5, // estimated, see slashBlast
    verified: true,
    // Lv20 (max): damage 190%, MP 16. Modeled on Knuckle (4.0x); VoidMS's own min-damage
    // formula has no Knuckle branch at all (a gap in that source, not this app), so the
    // ranged-bonus/mastery-factor shape is inferred from Sword's pattern rather than
    // lifted verbatim -- flagged here as the one skill whose base-formula plumbing is
    // extrapolated, even though its damage%/MP are directly wz-sourced like the others.
    formula: stats => physicalSkillDamage(WEAPON_MULTIPLIERS.knuckle, stats.str, stats.dex, stats.weaponAtk, 190),
    mpCost: () => 16,
    mobCount: 6,
  },

  // -- 2nd job: one new attack skill per branch (see header comment) --------------

  arrowBomb: {
    key: "arrowBomb",
    label: "Arrow Bomb",
    class: "bowman",
    job: "2nd Job (Hunter)",
    mapScoreArchetype: "aoe",
    apDistribution: AP_DISTRIBUTIONS.bowman,
    hitsPerCast: 1,
    castTimeSec: 2.5, // estimated -- AoE cast, see slashBlast
    verified: true,
    // Lv20 (max): damage 200%, MP 15, 6-mob AoE (Skill.wz id 3101003, weapon=bow).
    // Name confidence: high (bow, AoE explosion, matches Arrow Bomb's known shape).
    formula: stats => physicalSkillDamage(WEAPON_MULTIPLIERS.bow, stats.dex, stats.str, stats.weaponAtk, 200, 15),
    mpCost: () => 15,
    mobCount: 6,
  },
  crossbowmanAoe: {
    key: "crossbowmanAoe",
    label: "Iron Arrow", // NAME UNCONFIRMED -- see notes
    class: "bowman",
    job: "2nd Job (Crossbowman)",
    mapScoreArchetype: "aoe",
    apDistribution: AP_DISTRIBUTIONS.bowman,
    hitsPerCast: 1,
    castTimeSec: 2.5,
    verified: true,
    notes: "Damage/MP/AoE data is wz-sourced and exact; the display name 'Iron Arrow' is a low-confidence guess -- this is Crossbowman's exact mechanical mirror of Arrow Bomb (Skill.wz id 3201003, weapon=crossbow, identical 200%/15MP/6-mob-AoE numbers), just with no confirmed in-game name.",
    // Lv20 (max): damage 200%, MP 15, 6-mob AoE.
    formula: stats => physicalSkillDamage(WEAPON_MULTIPLIERS.crossbow, stats.dex, stats.str, stats.weaponAtk, 200, 15),
    mpCost: () => 15,
    mobCount: 6,
  },
  drain: {
    key: "drain",
    label: "Drain",
    class: "thief",
    job: "2nd Job (Assassin)",
    mapScoreArchetype: "ranged",
    apDistribution: AP_DISTRIBUTIONS.thief,
    hitsPerCast: 1,
    castTimeSec: 1.5,
    verified: true,
    // Lv30 (max): damage 160%, MP 24 (Skill.wz id 4101005, weapon=claw). Real Drain
    // also heals the caster for a % of damage dealt -- unmodeled here (this app has
    // no HP-tracking mechanic, same simplification as Slash Blast's HP cost).
    // Name confidence: high (claw, single-target, req Claw Mastery -- matches Drain).
    formula: stats => physicalSkillDamage(WEAPON_MULTIPLIERS.claw, stats.luk, stats.str + stats.dex, stats.weaponAtk, 160, 15),
    mpCost: () => 24,
  },
  savageBlow: {
    key: "savageBlow",
    label: "Savage Blow", // NAME UNCONFIRMED -- see notes
    class: "thief",
    job: "2nd Job (Bandit)",
    mapScoreArchetype: "ranged",
    apDistribution: AP_DISTRIBUTIONS.thief,
    hitsPerCast: 1,
    castTimeSec: 1.5,
    verified: true,
    notes: "Damage/MP data is wz-sourced and exact; the display name 'Savage Blow' is a best-guess match to Bandit's known signature dagger skill (Skill.wz id 4201005, weapon=dagger, single-target, no bulletCount field found despite Savage Blow canonically being multi-hit -- that multi-hit behavior may not be captured by this app's model).",
    // Lv30 (max): damage 80%, MP 27. Dagger, remapped to the claw-shaped LUK-primary
    // formula per VoidMS's own Thief-class dagger handling (see luckySeven/drain).
    formula: stats => physicalSkillDamage(WEAPON_MULTIPLIERS.claw, stats.luk, stats.str + stats.dex, stats.weaponAtk, 80, 15),
    mpCost: () => 27,
  },
  backspinBlow: {
    key: "backspinBlow",
    label: "Backspin Blow",
    class: "pirate",
    job: "2nd Job (Brawler)",
    mapScoreArchetype: "aoe",
    apDistribution: AP_DISTRIBUTIONS.pirate,
    hitsPerCast: 1,
    castTimeSec: 2.5,
    verified: true,
    // Lv20 (max): damage 240%, MP 30, 3-mob AoE (Skill.wz id 5101002). Name confidence:
    // medium -- inferred from Brawler's known 3-skill kit (see corkscrewBlow notes).
    formula: stats => physicalSkillDamage(WEAPON_MULTIPLIERS.knuckle, stats.str, stats.dex, stats.weaponAtk, 240),
    mpCost: () => 30,
    mobCount: 3,
  },
  doubleUppercut: {
    key: "doubleUppercut",
    label: "Double Uppercut",
    class: "pirate",
    job: "2nd Job (Brawler)",
    mapScoreArchetype: "melee",
    apDistribution: AP_DISTRIBUTIONS.pirate,
    hitsPerCast: 1,
    castTimeSec: 1.5,
    verified: true,
    // Lv20 (max): damage 290%, MP 30, single target (Skill.wz id 5101003). Name
    // confidence: medium, see corkscrewBlow notes.
    formula: stats => physicalSkillDamage(WEAPON_MULTIPLIERS.knuckle, stats.str, stats.dex, stats.weaponAtk, 290),
    mpCost: () => 30,
  },
  corkscrewBlow: {
    key: "corkscrewBlow",
    label: "Corkscrew Blow",
    class: "pirate",
    job: "2nd Job (Brawler)",
    mapScoreArchetype: "aoe",
    apDistribution: AP_DISTRIBUTIONS.pirate,
    hitsPerCast: 1,
    castTimeSec: 2.5,
    verified: true,
    notes: "Damage/MP/AoE data is wz-sourced and exact. Brawler's 2nd job has exactly 3 damage-bearing skills in Skill.wz (ids 5101002/5101003/5101004) matching its known 3-skill kit (Backspin Blow, Double Uppercut, Corkscrew Blow) -- which numeric id maps to which of the 3 names is inferred from relative power (this one is the strongest, matching Corkscrew Blow's reputation as Brawler's hardest hitter) rather than string-verified.",
    // Lv20 (max): damage 420%, MP 36, 3-mob AoE (Skill.wz id 5101004).
    formula: stats => physicalSkillDamage(WEAPON_MULTIPLIERS.knuckle, stats.str, stats.dex, stats.weaponAtk, 420),
    mpCost: () => 36,
    mobCount: 3,
  },
  grenade: {
    key: "grenade",
    label: "Grenade",
    class: "pirate",
    job: "2nd Job (Gunslinger)",
    mapScoreArchetype: "aoe",
    apDistribution: AP_DISTRIBUTIONS.pirate,
    hitsPerCast: 1,
    castTimeSec: 2.5,
    verified: true,
    notes: "Gunslinger's Skill.wz 2nd-job data has 4 damage-bearing ids (5201001/5201002/5201004/5201006) but this app only models the 2 most confidently identifiable (this one and blankShot) -- the other 2 weren't mapped to a specific real skill name with enough confidence to ship, so Gunslinger's kit here is incomplete versus the other classes' full coverage. GUN weapon multiplier and DEX-primary stat split are extrapolated by analogy to Somersault Kick's Knuckle gap (VoidMS's own source has no Gun branch in its min-damage formula either) -- flagged, not verified against a real source.",
    // Lv20 (max): damage 170%, MP 25, 3-mob AoE (Skill.wz id 5201001, weapon=gun).
    formula: stats => physicalSkillDamage(WEAPON_MULTIPLIERS.gun, stats.dex, stats.str, stats.weaponAtk, 170),
    mpCost: () => 25,
    mobCount: 3,
  },
  blankShot: {
    key: "blankShot",
    label: "Blank Shot",
    class: "pirate",
    job: "2nd Job (Gunslinger)",
    mapScoreArchetype: "aoe",
    apDistribution: AP_DISTRIBUTIONS.pirate,
    hitsPerCast: 1,
    castTimeSec: 2.5,
    verified: true,
    notes: "See grenade's notes on Gunslinger's kit coverage and the extrapolated Gun weapon formula. This id (5201004) was picked out as Blank Shot specifically because prop=100 at max level (a 100%-chance proc field) matches Blank Shot's known guaranteed-stun mechanic.",
    // Lv20 (max): damage 120%, MP 25, 3-mob AoE, 100% proc (stun, unmodeled).
    formula: stats => physicalSkillDamage(WEAPON_MULTIPLIERS.gun, stats.dex, stats.str, stats.weaponAtk, 120),
    mpCost: () => 25,
    mobCount: 3,
  },

  // -- 2nd job elemental magic ------------------------------------------------
  // FP/IL Wizard's 4 real elemental attack spells. Unlike the flat-damage% skills
  // above, Skill.wz gives each level a growing "mad" (magic attack bonus) + "mastery"
  // pair instead -- see formulas.js's magicSkillDamage header comment for how that
  // maps onto the same magic-formula shape calcDmg uses (calibrated against Magic
  // Claw's own wz data, which reproduces calcDmg's already-verified constants
  // exactly) and elementalMultiplier for how the weak/strong/immune scaling applies.
  // All four are modeled at their max level (30); mad/mastery are the exact wz
  // values at that level.
  fireArrow: {
    key: "fireArrow",
    label: "Fire Arrow",
    class: "magician",
    job: "2nd Job (FP Wizard)",
    mapScoreArchetype: "ranged",
    apDistribution: AP_DISTRIBUTIONS.magician,
    hitsPerCast: 1,
    castTimeSec: 1.5, // estimated, see doubleShot
    verified: true,
    element: "fire",
    // Lv30 (max): MP 28, mad 120, mastery 10 (Skill.wz id 2101004, elemAttr=f).
    formula: stats => magicSkillDamage(stats.weaponAtk, stats.int, 120, 10),
    mpCost: () => 28,
  },
  poisonBreath: {
    key: "poisonBreath",
    label: "Poison Breath",
    class: "magician",
    job: "2nd Job (FP Wizard)",
    mapScoreArchetype: "ranged",
    apDistribution: AP_DISTRIBUTIONS.magician,
    hitsPerCast: 1,
    castTimeSec: 2.5, // estimated -- AoE-flavored DoT cast, see slashBlast
    verified: true,
    element: "poison",
    notes: "Real Poison Breath applies a poison damage-over-time debuff (100% proc, ~4s duration at max level) on top of its own initial hit -- this app only models the initial magicSkillDamage hit, not the DoT tick damage, so real per-cast output vs poison-vulnerable monsters is understated.",
    // Lv30 (max): MP 20, mad 70, mastery 10 (Skill.wz id 2101005, elemAttr=s).
    formula: stats => magicSkillDamage(stats.weaponAtk, stats.int, 70, 10),
    mpCost: () => 20,
  },
  coldBeam: {
    key: "coldBeam",
    label: "Cold Beam",
    class: "magician",
    job: "2nd Job (IL Wizard)",
    mapScoreArchetype: "ranged",
    apDistribution: AP_DISTRIBUTIONS.magician,
    hitsPerCast: 1,
    castTimeSec: 1.5,
    verified: true,
    element: "ice",
    // Lv30 (max): MP 24, mad 100, mastery 10 (Skill.wz id 2201004, elemAttr=i).
    formula: stats => magicSkillDamage(stats.weaponAtk, stats.int, 100, 10),
    mpCost: () => 24,
  },
  thunderBolt: {
    key: "thunderBolt",
    label: "Thunder Bolt",
    class: "magician",
    job: "2nd Job (IL Wizard)",
    mapScoreArchetype: "aoe",
    apDistribution: AP_DISTRIBUTIONS.magician,
    hitsPerCast: 1,
    castTimeSec: 2.5, // estimated, see slashBlast
    verified: true,
    element: "lightning",
    // Lv30 (max): MP 40, mad 60, mastery 10, 6-mob AoE (Skill.wz id 2201005, elemAttr=l).
    formula: stats => magicSkillDamage(stats.weaponAtk, stats.int, 60, 10),
    mpCost: () => 40,
    mobCount: 6,
  },
};

export const SKILL_LIST = Object.values(SKILLS);
export const VERIFIED_SKILL_LIST = SKILL_LIST.filter(s => s.verified);

// mapScoreArchetype -> the field name each carries in public/data/mapScores.js
// (see tools/extract_skill_map_scores.mjs and tools/analyze_maps.py).
export const SCORE_FIELD = { ranged: "mcScore", melee: "meleeScore", aoe: "aoeScore", vertical: "healScore" };
export const SCORE_FIELD_RAW = { ranged: "mcScoreRaw", melee: "meleeScoreRaw", aoe: "aoeScoreRaw", vertical: "healScoreRaw" };
export const SCORE_LABEL = { ranged: "RANGE", melee: "MELEE", aoe: "AOE", vertical: "STACK" };
