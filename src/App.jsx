import { useState, useMemo, useEffect, useRef } from "react";

// -- Default character stats (overridden by UI panel) -----------------------
const DEFAULT_CHAR = { level:20, int:87, luk:23, weaponMatk:21, mpMax:571, expPct:28 };
// AP distribution per level: +4 INT, +1 LUK
const INT_PER_LEVEL = 4;
const LUK_PER_LEVEL = 1;

function statsAtLevel(lvl, baseChar) {
  const g = lvl - baseChar.level;
  const int_ = baseChar.int + g * INT_PER_LEVEL;
  const luk_ = baseChar.luk + g * LUK_PER_LEVEL;
  const mpMax = baseChar.mpMax + g * (6 + Math.floor((baseChar.int + g * 2) / 10));
  return { level:lvl, int:int_, luk:luk_, weaponMatk:baseChar.weaponMatk, mpMax };
}

const EXP_MULTI = 2;
const SPELL_ATK = 40, MASTERY = 0.60;
// Magic Claw fires 2 separate hits per cast, each rolled independently off this formula.
const MC_HITS_PER_CAST = 2;

function calcDmg(matk, int_) {
  const magic = matk + int_;
  return {
    min: ((magic**2/1000 + magic*MASTERY*0.9)/30 + int_/200)*SPELL_ATK,
    max: ((magic**2/1000 + magic)/30 + int_/200)*SPELL_ATK,
  };
}

function hitsToKill(hp, mdef, dmgMin) {
  const eh = hp + mdef;
  if (dmgMin >= eh) return 1;
  if (dmgMin * 2 >= eh) return 2;
  return Math.ceil(eh / dmgMin);
}

function effRatio(hp, mdef, exp) {
  return (hp + mdef) / (exp * EXP_MULTI);
}

// -- Heal skill formula (v62 pre-BB, source: Ayumilove/Southperry formula compilation) --
// Heal Lv N: MP cost = 29 + N, Skill% = N * 15%, hits up to 6 undead per cast
// MIN = (INT*0.3 + LUK) * Magic/1000 * targetMult * skillPct
// MAX = (INT*1.2 + LUK) * Magic/1000 * targetMult * skillPct
// targetMult = 1.5 + 5/numTargets (1 target=6.5, 2=4.0, 3=3.167, 4=2.75, 5=2.5, 6=2.333)
function healDmg(healLvl, numTargets, int_, luk, weaponMatk) {
  if (healLvl === 0) return { min: 0, max: 0, mpCost: 0 };
  const magic = int_ + weaponMatk;
  const skillPct = (healLvl * 15) / 100;
  const targetMult = 1.5 + 5 / numTargets;
  const mpCost = 29 + healLvl;
  const min = (int_ * 0.3 + luk) * magic / 1000 * targetMult * skillPct;
  const max = (int_ * 1.2 + luk) * magic / 1000 * targetMult * skillPct;
  return { min, max, mpCost };
}

function healCastsToKill(hp, mdef, healLvl, numTargets, int_, luk, weaponMatk) {
  if (healLvl === 0) return null;
  const eh = hp + mdef;
  const { min } = healDmg(healLvl, numTargets, int_, luk, weaponMatk);
  if (min <= 0) return null;
  return Math.ceil(eh / min);
}

function healEffRatio(hp, mdef, exp, numTargets) {
  return (hp + mdef) / (exp * EXP_MULTI * Math.min(numTargets, 6));
}

function oneshotLevel(hp, mdef, baseChar) {
  const eh = hp + mdef;
  for (let lvl = baseChar.level; lvl <= 80; lvl++) {
    const s = statsAtLevel(lvl, baseChar);
    const d = calcDmg(s.weaponMatk, s.int);
    if (d.min * MC_HITS_PER_CAST >= eh) return lvl;
  }
  return null;
}

// -- Monster database (source: meowdb.com/msclassic, cross-ref legends.ml) --
// STATS (HP/MP/EXP/wAtk/mAtk/wDef/mDef/acc/avoid/level) for 88/105 monsters have been
// corrected to real values pulled from a Cosmic v83 client dump (Mob.wz + String.wz,
// github.com/P0nk/Cosmic), matched by name+level with tolerance ±6 levels. These were
// INITIALLY left untouched on the assumption Cosmic v83's numbers reflected a different,
// rebalanced server -- that assumption was wrong. Spot-checking 7 monsters directly
// against legends.ml (MapleLegends' own live library: Snail, Red Snail, Slime, Green
// Mushroom, Death Teddy, Master Death Teddy, Chronos) found the Cosmic v83 dump matches
// MapleLegends' real values exactly in all 7 cases -- so it was applied as authoritative
// for the 88 resolved monsters. The remaining 17/105 unresolved monsters still carry the
// original meowdb-sourced numbers, unverified either way.
// weak/immune elemental tags and undead status were also cross-verified against the same
// dump where a name+level match was found. "strong" (partial elemental resist) was
// cleared across the board -- no such tier exists in the classic/pre-BB elemental system
// (elemAttr digits only ever run 1-3: immune/normal/weak, confirmed by scanning all
// 1,564 Mob.wz files in the dump).
const MONSTER_DB = [
  { id:2, name:"Snail", level:1, hp:8, mp:0, wAtk:12, mAtk:0, wDef:0, mDef:0, acc:20, avoid:0, exp:3, weak:"-", strong:"-", immune:"-", boss:false, location:"Maple Island, Victoria Island" },
  { id:3, name:"Blue Snail", level:2, hp:15, mp:15, wAtk:17, mAtk:0, wDef:0, mDef:0, acc:20, avoid:0, exp:4, weak:"-", strong:"-", immune:"-", boss:false, location:"Maple Island, Victoria Island" },
  { id:4, name:"Shroom", level:2, hp:20, mp:15, wAtk:17, mAtk:0, wDef:0, mDef:0, acc:30, avoid:0, exp:5, weak:"-", strong:"-", immune:"-", boss:false, location:"Ellinia" },
  { id:5, name:"Red Snail", level:4, hp:40, mp:30, wAtk:27, mAtk:0, wDef:3, mDef:10, acc:35, avoid:0, exp:8, weak:"-", strong:"-", immune:"-", boss:false, location:"Maple Island, Victoria Island" },
  { id:6, name:"Stump", level:4, hp:40, mp:30, wAtk:30, mAtk:0, wDef:0, mDef:10, acc:30, avoid:0, exp:8, weak:"Fire", strong:"-", immune:"-", boss:false, location:"Victoria Island" },
  { id:7, name:"Slime", level:6, hp:50, mp:35, wAtk:32, mAtk:0, wDef:5, mDef:10, acc:35, avoid:1, exp:10, weak:"Lightning", strong:"-", immune:"-", boss:false, location:"Victoria Island" },
  { id:8, name:"Pig", level:7, hp:75, mp:40, wAtk:37, mAtk:0, wDef:5, mDef:20, acc:40, avoid:0, exp:15, weak:"-", strong:"-", immune:"-", boss:false, location:"Henesys area" },
  { id:9, name:"Orange Mushroom", level:8, hp:80, mp:45, wAtk:42, mAtk:0, wDef:0, mDef:10, acc:42, avoid:1, exp:15, weak:"-", strong:"-", immune:"-", boss:false, location:"Henesys area" },
  { id:10, name:"Ribbon Pig", level:10, hp:120, mp:45, wAtk:70, mAtk:0, wDef:10, mDef:30, acc:40, avoid:2, exp:20, weak:"-", strong:"-", immune:"-", boss:false, location:"Henesys area" },
  { id:11, name:"Dark Stump", level:10, hp:250, mp:10, wAtk:65, mAtk:0, wDef:20, mDef:10, acc:42, avoid:0, exp:18, weak:"Fire", strong:"-", immune:"-", boss:false, location:"Perion area" },
  { id:12, name:"Octopus", level:12, hp:200, mp:50, wAtk:82, mAtk:0, wDef:10, mDef:40, acc:40, avoid:4, exp:24, weak:"Lightning", strong:"-", immune:"-", boss:false, location:"Nautilus, Florina Beach" },
  { id:13, name:"Green Mushroom", level:15, hp:250, mp:25, wAtk:82, mAtk:0, wDef:12, mDef:40, acc:45, avoid:5, exp:26, weak:"-", strong:"-", immune:"Poison", boss:false, location:"Ellinia, Sleepywood" },
  { id:14, name:"Bubbling", level:15, hp:240, mp:10, wAtk:80, mAtk:0, wDef:40, mDef:50, acc:80, avoid:5, exp:26, weak:"-", strong:"-", immune:"-", boss:false, location:"Florina Beach" },
  { id:15, name:"Axe Stump", level:17, hp:300, mp:30, wAtk:85, mAtk:0, wDef:30, mDef:10, acc:50, avoid:5, exp:30, weak:"-", strong:"-", immune:"-", boss:false, location:"Perion, Kerning area" },
  { id:16, name:"Blue Mushroom", level:20, hp:350, mp:30, wAtk:90, mAtk:0, wDef:10, mDef:60, acc:55, avoid:7, exp:32, weak:"-", strong:"-", immune:"-", boss:false, location:"Sleepywood" },
  { id:17, name:"Stirge", level:20, hp:300, mp:10, wAtk:85, mAtk:0, wDef:20, mDef:20, acc:80, avoid:10, exp:33, weak:"-", strong:"-", immune:"-", boss:false, location:"Kerning Subway, Dungeon" },
  { id:700004, name:"Mano", level:20, hp:2000, mp:30, wAtk:90, mAtk:0, wDef:20, mDef:30, acc:60, avoid:8, exp:120, weak:"-", strong:"-", immune:"-", boss:true, location:"Beach III (1 spawn, 1hr respawn, Slow debuff)" },
  { id:18, name:"Jr. Necki", level:21, hp:285, mp:20, wAtk:100, mAtk:0, wDef:30, mDef:30, acc:120, avoid:25, exp:38, weak:"-", strong:"-", immune:"-", boss:false, location:"Kerning Subway, Swamp" },
  { id:800000, name:"Ligator", level:21, hp:778, mp:50, wAtk:131, mAtk:0, wDef:10, mDef:0, acc:92, avoid:9, exp:68, weak:"Fire", strong:"-", immune:"-", boss:false, location:"Florina Beach" },
  { id:19, name:"Horny Mushroom", level:22, hp:300, mp:35, wAtk:90, mAtk:0, wDef:30, mDef:0, acc:55, avoid:7, exp:35, weak:"-", strong:"-", immune:"-", boss:false, location:"Sleepywood, Perion" },
  { id:20, name:"Dark Axe Stump", level:22, hp:550, mp:40, wAtk:85, mAtk:0, wDef:50, mDef:20, acc:45, avoid:7, exp:38, weak:"Fire", strong:"-", immune:"-", boss:false, location:"Perion, Kerning area" },
  { id:21, name:"Zombie Mushroom", level:24, hp:500, mp:50, wAtk:95, mAtk:0, wDef:20, mDef:30, acc:50, avoid:8, exp:42, weak:"Holy", strong:"-", immune:"-", boss:false, location:"Sleepywood" },
  { id:22, name:"Wild Boar", level:25, hp:550, mp:55, wAtk:90, mAtk:0, wDef:20, mDef:30, acc:50, avoid:8, exp:42, weak:"-", strong:"-", immune:"-", boss:false, location:"Perion area" },
  { id:1000, name:"Trixter", level:23, hp:450, mp:0, wAtk:95, mAtk:0, wDef:52, mDef:65, acc:93, avoid:10, exp:42, weak:"Fire", strong:"-", immune:"-", boss:false, location:"Florina Beach" },
  { id:800001, name:"Jr. Necki (Strong)", level:25, hp:765, mp:30, wAtk:139, mAtk:0, wDef:0, mDef:30, acc:111, avoid:12, exp:80, weak:"-", strong:"-", immune:"-", boss:false, location:"Alt spawn" },
  { id:1001, name:"Jr. Sentinel", level:23, hp:600, mp:10, wAtk:70, mAtk:0, wDef:30, mDef:40, acc:55, avoid:8, exp:40, weak:"-", strong:"-", immune:"-", boss:false, location:"Orbis" },
  { id:23, name:"Evil Eye", level:27, hp:720, mp:40, wAtk:100, mAtk:0, wDef:35, mDef:70, acc:60, avoid:10, exp:50, weak:"-", strong:"-", immune:"-", boss:false, location:"Ellinia, Henesys area" },
  { id:24, name:"Iron Hog", level:28, hp:572, mp:50, wAtk:136, mAtk:0, wDef:500, mDef:100, acc:104, avoid:17, exp:52, weak:"Lightning", strong:"-", immune:"-", boss:false, location:"Perion area" },
  { id:1002, name:"Green Trixter", level:28, hp:780, mp:0, wAtk:105, mAtk:0, wDef:75, mDef:75, acc:115, avoid:12, exp:55, weak:"-", strong:"-", immune:"Poison", boss:false, location:"Florina Beach" },
  { id:25, name:"Fairy 1", level:30, hp:800, mp:175, wAtk:80, mAtk:0, wDef:85, mDef:105, acc:145, avoid:25, exp:120, weak:"-", strong:"-", immune:"-", boss:false, location:"Ellinia" },
  { id:26, name:"Fairy 2", level:30, hp:800, mp:175, wAtk:80, mAtk:0, wDef:85, mDef:105, acc:145, avoid:25, exp:120, weak:"-", strong:"-", immune:"-", boss:false, location:"Ellinia" },
  { id:27, name:"Fairy 3", level:30, hp:800, mp:175, wAtk:80, mAtk:0, wDef:85, mDef:105, acc:145, avoid:25, exp:120, weak:"-", strong:"-", immune:"-", boss:false, location:"Ellinia" },
  { id:28, name:"Fairy 4", level:30, hp:800, mp:175, wAtk:80, mAtk:0, wDef:85, mDef:105, acc:145, avoid:25, exp:120, weak:"-", strong:"-", immune:"-", boss:false, location:"Ellinia" },
  { id:1003, name:"Sentinel", level:30, hp:900, mp:50, wAtk:120, mAtk:118, wDef:275, mDef:85, acc:75, avoid:12, exp:55, weak:"Ice", strong:"-", immune:"-", boss:false, location:"Orbis" },
  { id:1004, name:"Ice Sentinel", level:30, hp:900, mp:50, wAtk:105, mAtk:118, wDef:275, mDef:85, acc:75, avoid:12, exp:55, weak:"Fire", strong:"-", immune:"-", boss:false, location:"Orbis" },
  { id:1005, name:"Fire Sentinel", level:30, hp:900, mp:50, wAtk:105, mAtk:118, wDef:275, mDef:85, acc:75, avoid:12, exp:55, weak:"Ice", strong:"-", immune:"-", boss:false, location:"Orbis" },
  { id:29, name:"Ligator", level:32, hp:1200, mp:40, wAtk:110, mAtk:0, wDef:45, mDef:40, acc:70, avoid:12, exp:60, weak:"Fire", strong:"-", immune:"-", boss:false, location:"Swamp" },
  { id:30, name:"Fire Boar", level:32, hp:1000, mp:60, wAtk:110, mAtk:0, wDef:40, mDef:40, acc:60, avoid:10, exp:60, weak:"Ice", strong:"-", immune:"-", boss:false, location:"Perion" },
  { id:1011, name:"Leatty", level:32, hp:1000, mp:40, wAtk:110, mAtk:0, wDef:45, mDef:70, acc:65, avoid:13, exp:60, weak:"Fire", strong:"-", immune:"-", boss:false, location:"El Nath" },
  { id:800003, name:"King Slime", level:32, hp:16820, mp:100, wAtk:391, mAtk:391, wDef:15, mDef:15, acc:121, avoid:11, exp:248, weak:"-", strong:"-", immune:"-", boss:true, location:"Kerning Subway" },
  { id:31, name:"Curse Eye", level:35, hp:1250, mp:65, wAtk:120, mAtk:0, wDef:45, mDef:70, acc:60, avoid:10, exp:70, weak:"-", strong:"-", immune:"-", boss:false, location:"Ellinia, Henesys area" },
  { id:1012, name:"Jr. Cellion", level:33, hp:1100, mp:70, wAtk:105, mAtk:0, wDef:60, mDef:80, acc:95, avoid:15, exp:65, weak:"Ice", strong:"-", immune:"-", boss:false, location:"Orbis" },
  { id:1013, name:"Jr. Lioner", level:33, hp:1100, mp:70, wAtk:105, mAtk:0, wDef:60, mDef:80, acc:95, avoid:15, exp:65, weak:"Ice", strong:"-", immune:"-", boss:false, location:"Orbis" },
  { id:1014, name:"Jr. Grupin", level:33, hp:1100, mp:70, wAtk:105, mAtk:0, wDef:60, mDef:80, acc:95, avoid:15, exp:65, weak:"Fire", strong:"-", immune:"-", boss:false, location:"Orbis" },
  { id:1015, name:"Dark Leatty", level:33, hp:1100, mp:60, wAtk:120, mAtk:0, wDef:60, mDef:80, acc:65, avoid:15, exp:65, weak:"Holy", strong:"-", immune:"-", boss:false, location:"El Nath" },
  { id:32, name:"Jr. Wraith", level:35, hp:1200, mp:80, wAtk:110, mAtk:0, wDef:90, mDef:90, acc:100, avoid:17, exp:70, weak:"Holy", strong:"-", immune:"-", boss:false, location:"Kerning area" },
  { id:33, name:"Jr. Boogie 1", level:35, hp:1700, mp:300, wAtk:90, mAtk:0, wDef:120, mDef:155, acc:150, avoid:27, exp:150, weak:"-", strong:"-", immune:"-", boss:false, location:"Sleepywood" },
  { id:34, name:"Jr. Boogie 2", level:35, hp:1700, mp:300, wAtk:90, mAtk:0, wDef:120, mDef:155, acc:150, avoid:27, exp:150, weak:"-", strong:"-", immune:"-", boss:false, location:"Sleepywood" },
  { id:1019, name:"Star Pixie", level:35, hp:1300, mp:100, wAtk:120, mAtk:130, wDef:100, mDef:100, acc:145, avoid:21, exp:72, weak:"-", strong:"-", immune:"-", boss:false, location:"Orbis" },
  { id:1021, name:"Jr. Pepe", level:35, hp:1400, mp:70, wAtk:130, mAtk:0, wDef:110, mDef:100, acc:105, avoid:18, exp:75, weak:"Fire", strong:"-", immune:"-", boss:false, location:"Orbis" },
  { id:35, name:"Lupin", level:37, hp:1500, mp:100, wAtk:110, mAtk:125, wDef:35, mDef:40, acc:100, avoid:20, exp:77, weak:"-", strong:"-", immune:"-", boss:false, location:"Ludibrium" },
  { id:36, name:"Lorang", level:37, hp:1950, mp:10, wAtk:125, mAtk:0, wDef:100, mDef:200, acc:85, avoid:18, exp:80, weak:"Lightning", strong:"-", immune:"-", boss:false, location:"Aqua Road" },
  { id:54, name:"Glowshroom", level:39, hp:1377, mp:50, wAtk:232, mAtk:0, wDef:10, mDef:10, acc:118, avoid:24, exp:90, weak:"-", strong:"-", immune:"-", boss:false, location:"Aqua Road" },
  { id:37, name:"Cold Eye", level:40, hp:2000, mp:50, wAtk:130, mAtk:0, wDef:80, mDef:80, acc:65, avoid:15, exp:85, weak:"Fire", strong:"-", immune:"-", boss:false, location:"El Nath" },
  { id:55, name:"Raffle", level:40, hp:1722, mp:50, wAtk:216, mAtk:0, wDef:10, mDef:0, acc:120, avoid:24, exp:94, weak:"Fire", strong:"-", immune:"-", boss:false, location:"El Nath" },
  { id:700000, name:"Mushmom", level:45, hp:25500, mp:200, wAtk:140, mAtk:155, wDef:180, mDef:200, acc:210, avoid:21, exp:550, weak:"-", strong:"-", immune:"-", boss:true, location:"Henesys Mushroom Farm (1hr respawn)" },
  { id:38, name:"Zombie Lupin", level:40, hp:1800, mp:100, wAtk:120, mAtk:135, wDef:70, mDef:70, acc:110, avoid:25, exp:90, weak:"Holy", strong:"-", immune:"-", boss:false, location:"Ludibrium" },
  { id:1032, name:"Flyeye", level:41, hp:1600, mp:80, wAtk:130, mAtk:0, wDef:90, mDef:110, acc:160, avoid:28, exp:95, weak:"-", strong:"-", immune:"-", boss:false, location:"Orbis" },
  { id:56, name:"Golden Stirge", level:42, hp:1278, mp:50, wAtk:225, mAtk:0, wDef:0, mDef:0, acc:133, avoid:28, exp:103, weak:"-", strong:"-", immune:"-", boss:false, location:"Victoria Island" },
  { id:1036, name:"Nependeath", level:42, hp:2100, mp:120, wAtk:135, mAtk:145, wDef:120, mDef:120, acc:150, avoid:10, exp:99, weak:"Fire", strong:"-", immune:"-", boss:false, location:"Orbis" },
  { id:57, name:"Aqumander", level:43, hp:2069, mp:80, wAtk:252, mAtk:0, wDef:0, mDef:20, acc:123, avoid:26, exp:108, weak:"Lightning", strong:"-", immune:"-", boss:false, location:"Aqua Road" },
  { id:1039, name:"Jr. Cerebes", level:43, hp:2300, mp:20, wAtk:132, mAtk:0, wDef:290, mDef:150, acc:155, avoid:25, exp:102, weak:"-", strong:"-", immune:"-", boss:false, location:"El Nath" },
  { id:40, name:"Copper Drake", level:45, hp:2700, mp:150, wAtk:150, mAtk:0, wDef:100, mDef:100, acc:70, avoid:18, exp:105, weak:"-", strong:"-", immune:"-", boss:false, location:"Sleepywood" },
  { id:58, name:"Echopus", level:45, hp:2163, mp:80, wAtk:239, mAtk:0, wDef:10, mDef:20, acc:124, avoid:27, exp:117, weak:"Lightning", strong:"-", immune:"-", boss:false, location:"Aqua Road" },
  { id:1042, name:"Lunar Pixie", level:45, hp:2500, mp:115, wAtk:140, mAtk:155, wDef:145, mDef:160, acc:165, avoid:24, exp:105, weak:"-", strong:"-", immune:"-", boss:false, location:"Orbis" },
  { id:41, name:"Tortie", level:46, hp:2550, mp:100, wAtk:125, mAtk:160, wDef:300, mDef:300, acc:130, avoid:15, exp:110, weak:"-", strong:"-", immune:"-", boss:false, location:"Aqua Road" },
  { id:59, name:"Rafflesia", level:47, hp:2285, mp:80, wAtk:248, mAtk:0, wDef:20, mDef:10, acc:126, avoid:28, exp:127, weak:"Fire", strong:"-", immune:"-", boss:false, location:"Aqua Road" },
  { id:43, name:"Wraith", level:48, hp:2800, mp:80, wAtk:155, mAtk:0, wDef:180, mDef:180, acc:130, avoid:20, exp:120, weak:"Holy", strong:"-", immune:"-", boss:false, location:"Kerning area" },
  { id:44, name:"Clang", level:48, hp:3000, mp:50, wAtk:160, mAtk:0, wDef:120, mDef:150, acc:150, avoid:20, exp:128, weak:"Lightning", strong:"-", immune:"-", boss:false, location:"Aqua Road" },
  { id:45, name:"Drake", level:50, hp:3200, mp:100, wAtk:165, mAtk:0, wDef:110, mDef:150, acc:75, avoid:18, exp:135, weak:"-", strong:"-", immune:"-", boss:false, location:"Sleepywood" },
  { id:60, name:"Duskmander", level:50, hp:2682, mp:80, wAtk:234, mAtk:0, wDef:0, mDef:20, acc:129, avoid:29, exp:142, weak:"Ice", strong:"-", immune:"-", boss:false, location:"Aqua Road" },
  { id:1048, name:"Jr. Yeti", level:50, hp:3700, mp:20, wAtk:150, mAtk:0, wDef:170, mDef:180, acc:120, avoid:25, exp:135, weak:"Fire", strong:"-", immune:"-", boss:false, location:"El Nath" },
  { id:700002, name:"Zombie Mushmom", level:50, hp:53640, mp:220, wAtk:642, mAtk:706, wDef:10, mDef:20, acc:141, avoid:30, exp:568, weak:"Holy", strong:"-", immune:"-", boss:true, location:"Sleepywood" },
  { id:46, name:"Croco", level:52, hp:3800, mp:75, wAtk:172, mAtk:0, wDef:120, mDef:80, acc:80, avoid:20, exp:170, weak:"-", strong:"-", immune:"-", boss:false, location:"Swamp" },
  { id:1052, name:"Cellion", level:53, hp:4200, mp:160, wAtk:150, mAtk:175, wDef:170, mDef:210, acc:150, avoid:25, exp:160, weak:"Ice", strong:"-", immune:"-", boss:false, location:"Orbis" },
  { id:1053, name:"Lioner", level:53, hp:4200, mp:160, wAtk:150, mAtk:175, wDef:170, mDef:210, acc:150, avoid:25, exp:160, weak:"Ice", strong:"-", immune:"-", boss:false, location:"Orbis" },
  { id:1054, name:"Grupin", level:53, hp:4200, mp:160, wAtk:150, mAtk:175, wDef:170, mDef:210, acc:150, avoid:25, exp:160, weak:"Fire", strong:"-", immune:"-", boss:false, location:"Orbis" },
  { id:61, name:"Myewood", level:54, hp:3924, mp:120, wAtk:306, mAtk:306, wDef:10, mDef:0, acc:118, avoid:27, exp:168, weak:"Fire", strong:"-", immune:"-", boss:false, location:"Aqua Road" },
  { id:47, name:"Malady", level:55, hp:4000, mp:90, wAtk:170, mAtk:0, wDef:100, mDef:200, acc:150, avoid:20, exp:175, weak:"Holy", strong:"-", immune:"-", boss:false, location:"El Nath" },
  { id:1055, name:"Hector", level:55, hp:4600, mp:50, wAtk:165, mAtk:175, wDef:120, mDef:120, acc:100, avoid:20, exp:170, weak:"-", strong:"-", immune:"-", boss:false, location:"Ludibrium" },
  { id:48, name:"Stone Golem", level:55, hp:4000, mp:120, wAtk:180, mAtk:0, wDef:130, mDef:100, acc:80, avoid:15, exp:170, weak:"-", strong:"-", immune:"-", boss:false, location:"El Nath" },
  { id:62, name:"Rotten Mushroom", level:56, hp:3520, mp:90, wAtk:293, mAtk:0, wDef:20, mDef:10, acc:134, avoid:33, exp:190, weak:"Holy", strong:"-", immune:"-", boss:false, location:"Aqua Road" },
  { id:1056, name:"Dark Jr. Yeti", level:56, hp:4400, mp:40, wAtk:155, mAtk:0, wDef:180, mDef:190, acc:130, avoid:27, exp:180, weak:"Holy", strong:"-", immune:"-", boss:false, location:"El Nath" },
  { id:1058, name:"Coolie Zombie", level:57, hp:4500, mp:110, wAtk:165, mAtk:185, wDef:165, mDef:180, acc:135, avoid:25, exp:190, weak:"Holy", strong:"-", immune:"Poison", boss:false, location:"Ludibrium" },
  { id:49, name:"Dark Stone Golem", level:58, hp:4800, mp:150, wAtk:195, mAtk:0, wDef:150, mDef:200, acc:70, avoid:18, exp:200, weak:"Holy", strong:"-", immune:"-", boss:false, location:"El Nath" },
  { id:1059, name:"Minor Zombie", level:58, hp:3619, mp:60, wAtk:326, mAtk:326, wDef:10, mDef:20, acc:135, avoid:33, exp:197, weak:"Holy", strong:"-", immune:"Poison", boss:false, location:"Ludibrium" },
  { id:63, name:"Sporewood", level:59, hp:4834, mp:150, wAtk:331, mAtk:331, wDef:0, mDef:0, acc:122, avoid:30, exp:205, weak:"Holy/Fire", strong:"-", immune:"-", boss:false, location:"Aqua Road" },
  { id:1060, name:"White Fang", level:58, hp:5800, mp:100, wAtk:170, mAtk:205, wDef:200, mDef:220, acc:150, avoid:25, exp:220, weak:"Fire", strong:"-", immune:"-", boss:false, location:"El Nath" },
  { id:50, name:"Red Drake", level:60, hp:6000, mp:120, wAtk:200, mAtk:220, wDef:190, mDef:220, acc:150, avoid:22, exp:220, weak:"Ice", strong:"-", immune:"-", boss:false, location:"Sleepywood" },
  { id:700003, name:"Rotten Mushmom", level:60, hp:86400, mp:200, wAtk:752, mAtk:827, wDef:20, mDef:10, acc:150, avoid:34, exp:852, weak:"Holy/Fire", strong:"-", immune:"-", boss:true, location:"Sleepywood" },
  { id:51, name:"Wild Kargo", level:62, hp:5500, mp:100, wAtk:210, mAtk:0, wDef:180, mDef:130, acc:100, avoid:20, exp:240, weak:"-", strong:"-", immune:"-", boss:false, location:"Mu Lung" },
  { id:52, name:"Tauromacis", level:70, hp:15000, mp:200, wAtk:270, mAtk:320, wDef:250, mDef:250, acc:120, avoid:15, exp:270, weak:"-", strong:"-", immune:"Poison", boss:false, location:"Ludibrium" },
  { id:53, name:"Taurospear", level:75, hp:18000, mp:220, wAtk:300, mAtk:390, wDef:550, mDef:400, acc:130, avoid:30, exp:350, weak:"-", strong:"-", immune:"Poison", boss:false, location:"Ludibrium" },
  { id:1080, name:"Werewolf", level:75, hp:16000, mp:150, wAtk:330, mAtk:380, wDef:800, mDef:290, acc:160, avoid:25, exp:350, weak:"-", strong:"-", immune:"-", boss:false, location:"El Nath" },
  { id:700001, name:"Jr. Balrog", level:80, hp:50000, mp:500, wAtk:450, mAtk:605, wDef:420, mDef:450, acc:150, avoid:30, exp:2000, weak:"Holy", strong:"-", immune:"Poison", boss:true, location:"Sleepywood depths" },
  { id:700005, name:"Crimson Balrog", level:100, hp:100000, mp:500, wAtk:500, mAtk:720, wDef:800, mDef:800, acc:180, avoid:40, exp:3500, weak:"Holy", strong:"-", immune:"Poison", boss:true, location:"Nautilus" },
  { id:1025, name:"Chronos", level:37, hp:1750, mp:30, wAtk:117, mAtk:0, wDef:90, mDef:120, acc:135, avoid:20, exp:82, weak:"-", strong:"-", immune:"-", boss:false, location:"Ludibrium" },
  { id:1034, name:"Platoon Chronos", level:41, hp:2050, mp:50, wAtk:125, mAtk:142, wDef:130, mDef:160, acc:145, avoid:22, exp:99, weak:"-", strong:"-", immune:"-", boss:false, location:"Ludibrium" },
  { id:1047, name:"Master Chronos", level:46, hp:2600, mp:70, wAtk:130, mAtk:160, wDef:170, mDef:200, acc:155, avoid:24, exp:115, weak:"-", strong:"-", immune:"-", boss:false, location:"Ludibrium" },
  { id:1065, name:"Soul Teddy", level:63, hp:7600, mp:100, wAtk:190, mAtk:220, wDef:190, mDef:215, acc:140, avoid:25, exp:245, weak:"Holy", strong:"-", immune:"-", boss:false, location:"Ludibrium" },
  { id:1072, name:"Master Soul Teddy", level:67, hp:11000, mp:100, wAtk:210, mAtk:220, wDef:210, mDef:250, acc:140, avoid:27, exp:265, weak:"Holy", strong:"-", immune:"Ice", boss:false, location:"Ludibrium" },
  { id:1076, name:"Klock", level:70, hp:15000, mp:180, wAtk:250, mAtk:320, wDef:250, mDef:250, acc:130, avoid:26, exp:270, weak:"Holy", strong:"-", immune:"-", boss:false, location:"Ludibrium" },
  { id:1081, name:"Dark Klock", level:76, hp:18000, mp:200, wAtk:300, mAtk:350, wDef:380, mDef:400, acc:140, avoid:27, exp:370, weak:"Holy", strong:"-", immune:"-", boss:false, location:"Ludibrium" },
  { id:1087, name:"Death Teddy", level:85, hp:32000, mp:180, wAtk:375, mAtk:430, wDef:700, mDef:465, acc:160, avoid:27, exp:1300, weak:"Holy", strong:"-", immune:"-", boss:false, location:"Ludibrium" },
  { id:1089, name:"Master Death Teddy", level:89, hp:40000, mp:190, wAtk:400, mAtk:450, wDef:750, mDef:480, acc:180, avoid:28, exp:1720, weak:"Holy", strong:"-", immune:"-", boss:false, location:"Ludibrium" },
  { id:9300383, name:"Tutorial Muru", level:1, hp:8, mp:0, wAtk:12, mAtk:0, wDef:0, mDef:0, acc:20, avoid:0, exp:1, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9400205, name:"Blue Mushmom", level:90, hp:200000, mp:190, wAtk:450, mAtk:540, wDef:810, mDef:520, acc:220, avoid:64, exp:10000, weak:"Fire", strong:"-", immune:"-", boss:true, location:"1 map", undead:false, auto:true },
  { id:9400611, name:"Crocell", level:25, hp:2500, mp:150, wAtk:80, mAtk:90, wDef:50, mDef:60, acc:120, avoid:8, exp:60, weak:"-", strong:"-", immune:"-", boss:true, location:"1 map", undead:false, auto:true },
  { id:4230201, name:"Poison Poopa", level:40, hp:1910, mp:130, wAtk:120, mAtk:140, wDef:140, mDef:100, acc:150, avoid:18, exp:97, weak:"-", strong:"-", immune:"-", boss:false, location:"3 maps", undead:false, auto:true },
  { id:9300253, name:"Reinforced Mithril Mutae", level:50, hp:3000, mp:40, wAtk:140, mAtk:0, wDef:170, mDef:200, acc:80, avoid:15, exp:135, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300109, name:"Lord Pirate's Ginseng Jar", level:57, hp:4500, mp:160, wAtk:150, mAtk:0, wDef:190, mDef:210, acc:135, avoid:19, exp:95, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9300002, name:"Curse Eye (PC)", level:35, hp:2000, mp:130, wAtk:120, mAtk:0, wDef:90, mDef:140, acc:120, avoid:8, exp:280, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:5120501, name:"Bellflower Root", level:53, hp:4200, mp:160, wAtk:150, mAtk:0, wDef:170, mDef:210, acc:150, avoid:16, exp:160, weak:"-", strong:"-", immune:"-", boss:false, location:"4 maps", undead:false, auto:true },
  { id:9300145, name:"Homun", level:74, hp:33000, mp:240, wAtk:250, mAtk:250, wDef:290, mDef:300, acc:110, avoid:24, exp:330, weak:"-", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:9500174, name:"Manon", level:80, hp:205100, mp:1500, wAtk:165, mAtk:170, wDef:150, mDef:160, acc:170, avoid:0, exp:17200, weak:"Ice", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9500303, name:"Mirror Ghost 2", level:20, hp:350, mp:30, wAtk:1, mAtk:0, wDef:10, mDef:60, acc:999, avoid:999, exp:1, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9200022, name:"Separated Pepe", level:60, hp:7200, mp:100, wAtk:167, mAtk:0, wDef:210, mDef:225, acc:200, avoid:30, exp:420, weak:"Fire", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:7110300, name:"D. Roy", level:75, hp:16000, mp:150, wAtk:330, mAtk:380, wDef:800, mDef:290, acc:160, avoid:25, exp:350, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:true, auto:true },
  { id:9200000, name:"Wild Boar (PC)", level:25, hp:550, mp:55, wAtk:90, mAtk:0, wDef:20, mDef:30, acc:50, avoid:8, exp:42, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300273, name:"Target Pig", level:7, hp:75, mp:40, wAtk:37, mAtk:0, wDef:5, mDef:20, acc:40, avoid:0, exp:15, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:6400008, name:"Jr. Balrog", level:55, hp:30000, mp:500, wAtk:160, mAtk:240, wDef:420, mDef:450, acc:180, avoid:30, exp:10, weak:"Holy", strong:"-", immune:"Poison", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9420502, name:"Biner", level:18, hp:280, mp:30, wAtk:85, mAtk:0, wDef:30, mDef:10, acc:50, avoid:5, exp:30, weak:"-", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:9300142, name:"Homunculu of hidden laboratory", level:73, hp:15500, mp:240, wAtk:280, mAtk:315, wDef:300, mDef:320, acc:160, avoid:28, exp:320, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9500172, name:"Alishar", level:50, hp:20230, mp:500, wAtk:100, mAtk:110, wDef:38, mDef:40, acc:160, avoid:0, exp:1590, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9400110, name:"Leader A", level:62, hp:10000, mp:50, wAtk:190, mAtk:0, wDef:210, mDef:175, acc:165, avoid:26, exp:310, weak:"Poison", strong:"-", immune:"-", boss:false, location:"5 maps", undead:false, auto:true },
  { id:9400248, name:"Sand Rat", level:24, hp:600, mp:0, wAtk:95, mAtk:0, wDef:35, mDef:40, acc:55, avoid:10, exp:55, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:3300004, name:"Royal Guard Pepe", level:33, hp:900, mp:0, wAtk:80, mAtk:0, wDef:25, mDef:38, acc:75, avoid:13, exp:75, weak:"-", strong:"-", immune:"-", boss:false, location:"3 maps", undead:false, auto:true },
  { id:9300083, name:"Goblin Fire", level:11, hp:155, mp:40, wAtk:35, mAtk:0, wDef:10, mDef:40, acc:40, avoid:3, exp:22, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9300299, name:"Green Ribbon Pig of the Maze", level:10, hp:10, mp:10, wAtk:20, mAtk:0, wDef:10, mDef:10, acc:10, avoid:0, exp:1, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:2230107, name:"Krappy", level:24, hp:500, mp:50, wAtk:95, mAtk:0, wDef:20, mDef:30, acc:50, avoid:8, exp:45, weak:"Poison", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:5250000, name:"Mossy Mushroom", level:55, hp:4400, mp:110, wAtk:160, mAtk:0, wDef:100, mDef:120, acc:120, avoid:20, exp:175, weak:"-", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:9001002, name:"Athena Pierce's Clone", level:80, hp:120000, mp:510, wAtk:260, mAtk:0, wDef:260, mDef:220, acc:210, avoid:25, exp:2400, weak:"-", strong:"-", immune:"-", boss:true, location:"1 map", undead:false, auto:true },
  { id:9400743, name:"Angry Guard Dog", level:140, hp:160000, mp:300, wAtk:500, mAtk:160, wDef:700, mDef:800, acc:300, avoid:35, exp:70, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9300201, name:"Super-Charged Poison Golem", level:85, hp:113500, mp:500, wAtk:300, mAtk:250, wDef:280, mDef:220, acc:190, avoid:18, exp:17980, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9500164, name:"Black Kentaurus", level:88, hp:37000, mp:200, wAtk:390, mAtk:430, wDef:800, mDef:495, acc:170, avoid:28, exp:1600, weak:"Holy", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:true, auto:true },
  { id:9300016, name:"Platoon Cronos", level:41, hp:3050, mp:50, wAtk:125, mAtk:142, wDef:130, mDef:160, acc:145, avoid:24, exp:99, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:true, auto:true },
  { id:9500186, name:"Rideword B", level:15, hp:15, mp:0, wAtk:80, mAtk:0, wDef:10, mDef:40, acc:50, avoid:1, exp:20, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9400578, name:"Firebrand", level:90, hp:45000, mp:10000, wAtk:470, mAtk:560, wDef:920, mDef:700, acc:195, avoid:37, exp:2350, weak:"Ice", strong:"-", immune:"Fire", boss:false, location:"3 maps", undead:true, auto:true },
  { id:9400550, name:"Boomer", level:27, hp:700, mp:40, wAtk:105, mAtk:0, wDef:45, mDef:75, acc:75, avoid:10, exp:55, weak:"Ice", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9500121, name:"Wraith", level:48, hp:2800, mp:80, wAtk:155, mAtk:0, wDef:180, mDef:180, acc:130, avoid:20, exp:120, weak:"Holy", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:true, auto:true },
  { id:9300149, name:"Roid", level:78, hp:29000, mp:240, wAtk:250, mAtk:290, wDef:270, mDef:300, acc:150, avoid:18, exp:295, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300207, name:"Snack Bar", level:85, hp:230000, mp:1000, wAtk:480, mAtk:520, wDef:720, mDef:660, acc:200, avoid:40, exp:4230, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9400746, name:"Muscle Stone Minion", level:170, hp:2000000, mp:1000, wAtk:650, mAtk:0, wDef:800, mDef:750, acc:200, avoid:56, exp:30000, weak:"-", strong:"-", immune:"-", boss:true, location:"1 map", undead:false, auto:true },
  { id:9400539, name:"Urban Fungus", level:21, hp:350, mp:30, wAtk:90, mAtk:0, wDef:10, mDef:60, acc:55, avoid:7, exp:37, weak:"-", strong:"-", immune:"-", boss:false, location:"3 maps", undead:false, auto:true },
  { id:4300008, name:"Male Mannequin", level:45, hp:2500, mp:250, wAtk:150, mAtk:160, wDef:170, mDef:185, acc:130, avoid:21, exp:128, weak:"-", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:9500350, name:"Tae Roon", level:71, hp:93000, mp:200, wAtk:285, mAtk:310, wDef:335, mDef:265, acc:175, avoid:30, exp:1580, weak:"-", strong:"-", immune:"-", boss:true, location:"30 maps", undead:false, auto:true },
  { id:9300095, name:"Lycanthrope the Kidnapper", level:80, hp:19000, mp:300, wAtk:250, mAtk:310, wDef:450, mDef:420, acc:140, avoid:28, exp:850, weak:"Fire", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9300205, name:"Frankenroid", level:81, hp:660000, mp:2500, wAtk:400, mAtk:400, wDef:700, mDef:990, acc:170, avoid:28, exp:12000, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9500146, name:"Play Seal", level:42, hp:2250, mp:0, wAtk:135, mAtk:0, wDef:120, mDef:130, acc:150, avoid:18, exp:100, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:3100102, name:"Kiyo", level:30, hp:870, mp:50, wAtk:100, mAtk:0, wDef:40, mDef:40, acc:70, avoid:13, exp:60, weak:"-", strong:"-", immune:"-", boss:false, location:"3 maps", undead:false, auto:true },
  { id:9400557, name:"Psycho Jack Box", level:30, hp:10, mp:0, wAtk:95, mAtk:100, wDef:60, mDef:50, acc:80, avoid:12, exp:1, weak:"-", strong:"-", immune:"-", boss:false, location:"6 maps", undead:false, auto:true },
  { id:9300296, name:"The Cool Shade of the Maze", level:100, hp:10000, mp:100, wAtk:1, mAtk:1, wDef:1, mDef:1, acc:3000, avoid:3000, exp:1, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9500184, name:"Rideword P", level:15, hp:15, mp:0, wAtk:80, mAtk:0, wDef:10, mDef:40, acc:50, avoid:1, exp:20, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:3300008, name:"Prime Minister", level:38, hp:12500, mp:100, wAtk:130, mAtk:165, wDef:160, mDef:160, acc:140, avoid:10, exp:800, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9400573, name:"Baby typhon", level:40, hp:100, mp:100, wAtk:0, mAtk:0, wDef:0, mDef:0, acc:0, avoid:0, exp:10, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:2100107, name:"Scarf Plead", level:27, hp:700, mp:0, wAtk:100, mAtk:0, wDef:35, mDef:40, acc:55, avoid:10, exp:50, weak:"-", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:9300306, name:"Sky Mushroom of the Maze IV", level:10, hp:3, mp:10, wAtk:20, mAtk:0, wDef:10, mDef:10, acc:10, avoid:0, exp:1, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:3000005, name:"Brown Teddy", level:30, hp:950, mp:0, wAtk:100, mAtk:0, wDef:38, mDef:40, acc:65, avoid:12, exp:60, weak:"-", strong:"-", immune:"-", boss:false, location:"9 maps", undead:false, auto:true },
  { id:9400601, name:"Birthday Candle", level:20, hp:350, mp:40, wAtk:70, mAtk:0, wDef:20, mDef:20, acc:70, avoid:7, exp:33, weak:"Fire", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9300078, name:"Jr. Newtie in Cave", level:105, hp:68000, mp:200, wAtk:500, mAtk:550, wDef:750, mDef:680, acc:205, avoid:38, exp:1250, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9400562, name:"Hoodoo", level:60, hp:6800, mp:200, wAtk:190, mAtk:200, wDef:240, mDef:210, acc:210, avoid:22, exp:335, weak:"-", strong:"-", immune:"-", boss:false, location:"5 maps", undead:true, auto:true },
  { id:9300335, name:"Mateon", level:41, hp:2080, mp:150, wAtk:130, mAtk:135, wDef:120, mDef:120, acc:160, avoid:16, exp:99, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9400540, name:"Killa Bee", level:25, hp:730, mp:45, wAtk:105, mAtk:0, wDef:40, mDef:75, acc:65, avoid:5, exp:60, weak:"-", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:9300357, name:"Grii Gingerman", level:1, hp:10, mp:0, wAtk:0, mAtk:0, wDef:10, mDef:30, acc:55, avoid:4, exp:1, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:100124, name:"Tiguru", level:9, hp:100, mp:0, wAtk:50, mAtk:0, wDef:10, mDef:15, acc:40, avoid:1, exp:19, weak:"-", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:5250001, name:"Stone Bug", level:51, hp:3600, mp:40, wAtk:170, mAtk:0, wDef:255, mDef:200, acc:80, avoid:15, exp:142, weak:"-", strong:"-", immune:"-", boss:false, location:"3 maps", undead:false, auto:true },
  { id:4230200, name:"Poopa", level:40, hp:1900, mp:120, wAtk:100, mAtk:135, wDef:130, mDef:160, acc:150, avoid:18, exp:95, weak:"Poison", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:8150200, name:"Green Cornian", level:100, hp:56000, mp:200, wAtk:480, mAtk:0, wDef:800, mDef:500, acc:205, avoid:45, exp:3000, weak:"-", strong:"-", immune:"-", boss:false, location:"6 maps", undead:false, auto:true },
  { id:8142100, name:"Risell Squid", level:97, hp:49000, mp:210, wAtk:445, mAtk:500, wDef:830, mDef:550, acc:203, avoid:37, exp:2500, weak:"-", strong:"-", immune:"-", boss:false, location:"3 maps", undead:false, auto:true },
  { id:9400622, name:"Strange Blue Mushroom", level:20, hp:350, mp:30, wAtk:90, mAtk:0, wDef:10, mDef:60, acc:55, avoid:7, exp:32, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9400588, name:"Phantom Tree", level:50, hp:3500, mp:50, wAtk:140, mAtk:0, wDef:150, mDef:200, acc:150, avoid:10, exp:122, weak:"Fire", strong:"-", immune:"-", boss:false, location:"15 maps", undead:false, auto:true },
  { id:3210450, name:"Scuba Pepe", level:36, hp:1430, mp:0, wAtk:120, mAtk:0, wDef:90, mDef:155, acc:100, avoid:18, exp:80, weak:"-", strong:"-", immune:"-", boss:false, location:"3 maps", undead:false, auto:true },
  { id:9400216, name:"Zeta Gray (JP)", level:42, hp:2300, mp:150, wAtk:135, mAtk:150, wDef:165, mDef:180, acc:190, avoid:20, exp:102, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300237, name:"Ghost Pixie", level:59, hp:9000, mp:100, wAtk:200, mAtk:190, wDef:160, mDef:200, acc:130, avoid:25, exp:420, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:true, auto:true },
  { id:9600002, name:"Duck", level:22, hp:380, mp:35, wAtk:90, mAtk:0, wDef:20, mDef:20, acc:55, avoid:7, exp:37, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9400001, name:"Fire Raccoon", level:30, hp:900, mp:50, wAtk:95, mAtk:105, wDef:85, mDef:65, acc:65, avoid:12, exp:55, weak:"Ice", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:3210207, name:"Tick", level:34, hp:1100, mp:0, wAtk:115, mAtk:0, wDef:95, mDef:90, acc:90, avoid:14, exp:70, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9400548, name:"Mighty Maple Eater", level:30, hp:950, mp:40, wAtk:110, mAtk:110, wDef:50, mDef:70, acc:100, avoid:10, exp:65, weak:"Holy", strong:"-", immune:"-", boss:false, location:"4 maps", undead:false, auto:true },
  { id:3400003, name:"Yeti Doll Claw Game", level:38, hp:1600, mp:100, wAtk:120, mAtk:125, wDef:115, mDef:105, acc:105, avoid:18, exp:95, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9300012, name:"Alishar", level:56, hp:125000, mp:2500, wAtk:280, mAtk:260, wDef:210, mDef:240, acc:160, avoid:26, exp:4800, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9300116, name:"Lord Pirate's Enraged Captain", level:60, hp:2940, mp:100, wAtk:170, mAtk:270, wDef:250, mDef:350, acc:165, avoid:22, exp:72, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9300110, name:"Lord Pirate's Bellflower", level:58, hp:4700, mp:160, wAtk:150, mAtk:0, wDef:180, mDef:230, acc:150, avoid:18, exp:98, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9600004, name:"Goat", level:30, hp:900, mp:0, wAtk:100, mAtk:0, wDef:40, mDef:40, acc:65, avoid:12, exp:58, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9500306, name:"Mano", level:20, hp:2000, mp:30, wAtk:90, mAtk:0, wDef:20, mDef:30, acc:60, avoid:8, exp:120, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:6400004, name:"Opachu", level:70, hp:80000, mp:1000, wAtk:400, mAtk:600, wDef:350, mDef:550, acc:180, avoid:50, exp:250, weak:"Fire", strong:"-", immune:"Ice", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9400012, name:"Water Goblin", level:60, hp:7100, mp:150, wAtk:190, mAtk:250, wDef:200, mDef:230, acc:190, avoid:22, exp:220, weak:"Fire", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9300009, name:"Block Golem from Another Dimension", level:40, hp:6500, mp:0, wAtk:145, mAtk:0, wDef:130, mDef:110, acc:150, avoid:12, exp:408, weak:"Fire", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9500330, name:"Alishar", level:50, hp:32000, mp:250, wAtk:165, mAtk:150, wDef:110, mDef:150, acc:75, avoid:18, exp:675, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9400710, name:"Snowman3", level:60, hp:324000, mp:1000, wAtk:115, mAtk:120, wDef:95, mDef:90, acc:140, avoid:0, exp:350000, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9400243, name:"Stone Golem", level:55, hp:4000, mp:120, wAtk:180, mAtk:0, wDef:130, mDef:100, acc:80, avoid:15, exp:170, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9500190, name:"Toy Clown", level:1800, hp:70, mp:5, wAtk:140, mAtk:0, wDef:160, mDef:160, acc:150, avoid:17, exp:95, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300304, name:"Sky Mushroom of the Maze II", level:10, hp:3, mp:10, wAtk:20, mAtk:0, wDef:10, mDef:10, acc:10, avoid:0, exp:1, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9300365, name:"Grii Gingerman", level:1, hp:10, mp:0, wAtk:0, mAtk:0, wDef:750, mDef:690, acc:160, avoid:22, exp:1, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9300323, name:"Death Teddy ", level:67, hp:11500, mp:160, wAtk:210, mAtk:300, wDef:235, mDef:210, acc:130, avoid:26, exp:9, weak:"Holy", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9300046, name:"Star Pixie in Tower of Goddess", level:53, hp:6300, mp:200, wAtk:150, mAtk:160, wDef:170, mDef:120, acc:120, avoid:20, exp:320, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:7120106, name:"Overlord A", level:75, hp:15000, mp:150, wAtk:250, mAtk:350, wDef:250, mDef:250, acc:150, avoid:30, exp:330, weak:"-", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:5120502, name:"Sr. Bellflower Root", level:54, hp:4400, mp:160, wAtk:155, mAtk:0, wDef:180, mDef:215, acc:150, avoid:18, exp:168, weak:"-", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:9400559, name:"Sophilia Doll Ground", level:50, hp:2000, mp:150, wAtk:140, mAtk:130, wDef:170, mDef:170, acc:125, avoid:18, exp:55, weak:"-", strong:"-", immune:"-", boss:false, location:"11 maps", undead:false, auto:true },
  { id:9420527, name:"Chlorotrap", level:45, hp:2600, mp:115, wAtk:140, mAtk:0, wDef:160, mDef:180, acc:160, avoid:18, exp:132, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:4230112, name:"Master Robo", level:44, hp:2450, mp:0, wAtk:140, mAtk:0, wDef:210, mDef:195, acc:115, avoid:18, exp:105, weak:"-", strong:"-", immune:"-", boss:false, location:"4 maps", undead:false, auto:true },
  { id:9400606, name:"Giant Cake", level:70, hp:13000, mp:1000000, wAtk:220, mAtk:220, wDef:200, mDef:200, acc:170, avoid:27, exp:280, weak:"-", strong:"-", immune:"-", boss:true, location:"1 map", undead:false, auto:true },
  { id:9420532, name:"Ratatula", level:59, hp:6200, mp:150, wAtk:210, mAtk:220, wDef:220, mDef:190, acc:100, avoid:20, exp:210, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9300328, name:"Tutorial Tino", level:1, hp:9, mp:0, wAtk:17, mAtk:0, wDef:0, mDef:0, acc:20, avoid:0, exp:1, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:4230126, name:"Mummydog", level:47, hp:2750, mp:0, wAtk:145, mAtk:0, wDef:175, mDef:195, acc:130, avoid:18, exp:117, weak:"Holy", strong:"-", immune:"-", boss:false, location:"3 maps", undead:true, auto:true },
  { id:9500130, name:"Blue King Goblin", level:70, hp:25000, mp:200, wAtk:285, mAtk:335, wDef:280, mDef:280, acc:120, avoid:15, exp:400, weak:"Fire", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:8200005, name:"Qualm Monk", level:106, hp:71000, mp:200, wAtk:520, mAtk:560, wDef:690, mDef:750, acc:205, avoid:37, exp:3350, weak:"Fire", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9300131, name:"Toy Trojan", level:39, hp:2300, mp:0, wAtk:152, mAtk:0, wDef:110, mDef:100, acc:115, avoid:20, exp:115, weak:"-", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:9300129, name:"Ratz", level:30, hp:1600, mp:0, wAtk:150, mAtk:0, wDef:120, mDef:160, acc:100, avoid:25, exp:115, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9400244, name:"Mixed Golem", level:59, hp:6000, mp:150, wAtk:200, mAtk:190, wDef:160, mDef:220, acc:100, avoid:20, exp:210, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300100, name:"The Elemental Thanatos", level:108, hp:70000, mp:300, wAtk:510, mAtk:620, wDef:850, mDef:680, acc:210, avoid:38, exp:4100, weak:"Ice", strong:"-", immune:"Fire", boss:true, location:"1 map", undead:true, auto:true },
  { id:3300007, name:"White Yeti and King Pepe", level:35, hp:120000, mp:10000, wAtk:125, mAtk:120, wDef:50, mDef:70, acc:80, avoid:15, exp:210, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9300141, name:"Homun of Closed Laboratory", level:65, hp:11000, mp:80, wAtk:182, mAtk:270, wDef:170, mDef:245, acc:110, avoid:24, exp:255, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9300295, name:"The Dangerous Tree of the Maze", level:100, hp:10000, mp:100, wAtk:30000, mAtk:100, wDef:30000, mDef:30000, acc:150, avoid:10, exp:1, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:3230307, name:"Chirppy", level:31, hp:800, mp:0, wAtk:95, mAtk:0, wDef:60, mDef:50, acc:70, avoid:10, exp:62, weak:"-", strong:"-", immune:"-", boss:false, location:"3 maps", undead:false, auto:true },
  { id:8820007, name:"Mini Bean", level:150, hp:303000, mp:500, wAtk:700, mAtk:800, wDef:1200, mDef:1200, acc:240, avoid:50, exp:11000, weak:"Ice", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9400242, name:"Ribbon Pig", level:10, hp:120, mp:45, wAtk:70, mAtk:0, wDef:10, mDef:30, acc:40, avoid:2, exp:20, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:4230119, name:"Mateon", level:41, hp:2080, mp:150, wAtk:130, mAtk:135, wDef:120, mDef:120, acc:160, avoid:16, exp:99, weak:"-", strong:"-", immune:"-", boss:false, location:"5 maps", undead:false, auto:true },
  { id:9300264, name:"Dark Wyvern", level:103, hp:60000, mp:250, wAtk:505, mAtk:540, wDef:900, mDef:580, acc:205, avoid:38, exp:3150, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9400631, name:"Event Horntail's Right Head", level:60, hp:1000000, mp:500, wAtk:350, mAtk:320, wDef:700, mDef:600, acc:250, avoid:10, exp:10000, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9400613, name:"Valefor", level:25, hp:2500, mp:100, wAtk:90, mAtk:0, wDef:60, mDef:60, acc:120, avoid:8, exp:60, weak:"-", strong:"-", immune:"-", boss:true, location:"1 map", undead:false, auto:true },
  { id:9300209, name:"Blue Mushmom", level:90, hp:200000, mp:190, wAtk:450, mAtk:540, wDef:810, mDef:520, acc:220, avoid:64, exp:10000, weak:"Fire", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9300157, name:"Scorpion", level:25, hp:1200, mp:0, wAtk:65, mAtk:0, wDef:50, mDef:75, acc:85, avoid:11, exp:30, weak:"-", strong:"-", immune:"-", boss:false, location:"3 maps", undead:false, auto:true },
  { id:9300152, name:"Angry Frankenroid", level:84, hp:850000, mp:2500, wAtk:440, mAtk:440, wDef:800, mDef:990, acc:190, avoid:33, exp:25000, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9410003, name:"Clown Monkey", level:40, hp:1850, mp:100, wAtk:120, mAtk:130, wDef:140, mDef:150, acc:110, avoid:25, exp:95, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300133, name:"Robo", level:30, hp:3000, mp:0, wAtk:145, mAtk:0, wDef:200, mDef:200, acc:95, avoid:15, exp:120, weak:"-", strong:"-", immune:"-", boss:false, location:"4 maps", undead:false, auto:true },
  { id:9300062, name:"Flyeye", level:8, hp:80, mp:30, wAtk:25, mAtk:0, wDef:5, mDef:30, acc:40, avoid:1, exp:10, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:3400004, name:"Yeti Doll  ", level:35, hp:200, mp:0, wAtk:50, mAtk:0, wDef:50, mDef:50, acc:80, avoid:15, exp:5, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:6230401, name:"Jr. Lucida ", level:63, hp:7600, mp:100, wAtk:190, mAtk:200, wDef:190, mDef:220, acc:170, avoid:25, exp:245, weak:"Holy", strong:"-", immune:"Poison", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:7130401, name:"Blue King Goblin", level:70, hp:25000, mp:200, wAtk:285, mAtk:335, wDef:280, mDef:280, acc:120, avoid:15, exp:400, weak:"Fire", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9500347, name:"Zeno", level:65, hp:36000, mp:300, wAtk:205, mAtk:0, wDef:210, mDef:200, acc:150, avoid:29, exp:940, weak:"-", strong:"-", immune:"-", boss:true, location:"30 maps", undead:false, auto:true },
  { id:9300185, name:"Stumpy", level:35, hp:7000, mp:120, wAtk:125, mAtk:0, wDef:50, mDef:70, acc:80, avoid:12, exp:405, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9420506, name:"Batoo", level:23, hp:450, mp:50, wAtk:95, mAtk:0, wDef:20, mDef:30, acc:50, avoid:8, exp:40, weak:"-", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:9410013, name:"Doll Vending Machine", level:60, hp:6000, mp:400, wAtk:210, mAtk:225, wDef:180, mDef:190, acc:155, avoid:20, exp:280, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:4300012, name:"Fancy Amplifier ", level:49, hp:3000, mp:250, wAtk:165, mAtk:175, wDef:185, mDef:200, acc:145, avoid:23, exp:143, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9300172, name:"Poisoned Lord Tree", level:62, hp:6100, mp:100, wAtk:150, mAtk:170, wDef:150, mDef:130, acc:135, avoid:0, exp:235, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:2100108, name:"Meerkat", level:29, hp:780, mp:0, wAtk:100, mAtk:0, wDef:40, mDef:45, acc:60, avoid:10, exp:58, weak:"-", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:7120108, name:"Robby", level:77, hp:19000, mp:160, wAtk:325, mAtk:375, wDef:318, mDef:400, acc:168, avoid:22, exp:462, weak:"-", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:9300099, name:"Shark in Warped Dimension", level:100, hp:56000, mp:230, wAtk:490, mAtk:530, wDef:850, mDef:570, acc:205, avoid:38, exp:3000, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9300071, name:"Blue Wyvern 1 in Cave", level:101, hp:57000, mp:250, wAtk:495, mAtk:535, wDef:850, mDef:570, acc:205, avoid:38, exp:1000, weak:"Fire", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:2230111, name:"Rocky Mask", level:24, hp:600, mp:0, wAtk:95, mAtk:0, wDef:35, mDef:40, acc:55, avoid:10, exp:45, weak:"-", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:9400708, name:"Snowman1", level:20, hp:54000, mp:30, wAtk:45, mAtk:45, wDef:10, mDef:20, acc:140, avoid:1, exp:182, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9300119, name:"Lord Pirate", level:60, hp:420000, mp:300, wAtk:250, mAtk:310, wDef:670, mDef:455, acc:140, avoid:22, exp:7200, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9300098, name:"Bone Fish in Warped Dimension", level:92, hp:42500, mp:190, wAtk:420, mAtk:460, wDef:840, mDef:540, acc:197, avoid:38, exp:2000, weak:"Holy", strong:"-", immune:"-", boss:false, location:"1 map", undead:true, auto:true },
  { id:4300005, name:"Pink Perfume", level:42, hp:2000, mp:220, wAtk:140, mAtk:150, wDef:160, mDef:170, acc:120, avoid:20, exp:120, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300125, name:"Lord Pirate's Captain", level:62, hp:8700, mp:100, wAtk:215, mAtk:320, wDef:250, mDef:260, acc:165, avoid:23, exp:165, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:3230405, name:"Jr. Seal", level:38, hp:1850, mp:0, wAtk:125, mAtk:0, wDef:90, mDef:125, acc:130, avoid:18, exp:85, weak:"-", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:9200016, name:"Drumming Bunny", level:30, hp:950, mp:0, wAtk:100, mAtk:0, wDef:38, mDef:40, acc:65, avoid:12, exp:60, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9500107, name:"Drumming Bunny", level:30, hp:950, mp:0, wAtk:100, mAtk:0, wDef:38, mDef:40, acc:65, avoid:12, exp:60, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9200010, name:"Zombie Mushroom (PC)", level:24, hp:500, mp:50, wAtk:95, mAtk:0, wDef:20, mDef:30, acc:50, avoid:8, exp:42, weak:"Holy", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:true, auto:true },
  { id:8200001, name:"Memory Monk", level:91, hp:41000, mp:195, wAtk:400, mAtk:460, wDef:650, mDef:670, acc:190, avoid:37, exp:1900, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:100122, name:"Timu", level:5, hp:45, mp:0, wAtk:29, mAtk:0, wDef:3, mDef:10, acc:35, avoid:0, exp:9, weak:"-", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:9400006, name:"Blue Boogie", level:30, hp:1050, mp:140, wAtk:115, mAtk:0, wDef:120, mDef:105, acc:82, avoid:17, exp:60, weak:"Lightning", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300238, name:"Zombie Mushroom", level:24, hp:500, mp:50, wAtk:95, mAtk:0, wDef:20, mDef:30, acc:50, avoid:8, exp:42, weak:"Holy", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:true, auto:true },
  { id:9400609, name:"Andras", level:25, hp:2500, mp:100, wAtk:90, mAtk:0, wDef:60, mDef:50, acc:150, avoid:8, exp:60, weak:"-", strong:"-", immune:"-", boss:true, location:"1 map", undead:false, auto:true },
  { id:9420530, name:"Oly Oly", level:56, hp:4600, mp:110, wAtk:155, mAtk:0, wDef:170, mDef:180, acc:130, avoid:22, exp:185, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9400543, name:"Electrophant", level:41, hp:1600, mp:80, wAtk:130, mAtk:0, wDef:90, mDef:110, acc:160, avoid:28, exp:95, weak:"Fire", strong:"-", immune:"Ice", boss:false, location:"3 maps", undead:false, auto:true },
  { id:9300196, name:"Zombie Mushmom", level:65, hp:35000, mp:220, wAtk:250, mAtk:380, wDef:350, mDef:400, acc:155, avoid:30, exp:1500, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:true, auto:true },
  { id:9300111, name:"Lord Pirate's Ancient Bellflower", level:59, hp:4900, mp:160, wAtk:155, mAtk:0, wDef:180, mDef:235, acc:150, avoid:20, exp:100, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9200006, name:"Lupin (PC)", level:37, hp:1500, mp:100, wAtk:110, mAtk:125, wDef:35, mDef:40, acc:100, avoid:20, exp:77, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300243, name:"Samiho", level:56, hp:4500, mp:120, wAtk:165, mAtk:180, wDef:150, mDef:190, acc:135, avoid:28, exp:185, weak:"Fire", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9400558, name:"Psycho Jack", level:30, hp:850, mp:500, wAtk:95, mAtk:100, wDef:60, mDef:50, acc:80, avoid:12, exp:73, weak:"-", strong:"-", immune:"-", boss:false, location:"6 maps", undead:false, auto:true },
  { id:5120100, name:"MT-09", level:54, hp:13500, mp:170, wAtk:170, mAtk:180, wDef:280, mDef:280, acc:140, avoid:20, exp:980, weak:"-", strong:"-", immune:"-", boss:true, location:"1 map", undead:false, auto:true },
  { id:5110302, name:"Neo Huroid", level:58, hp:5600, mp:200, wAtk:170, mAtk:205, wDef:180, mDef:210, acc:155, avoid:20, exp:205, weak:"-", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:8200007, name:"Qualm Guardian", level:113, hp:90000, mp:260, wAtk:560, mAtk:638, wDef:940, mDef:570, acc:210, avoid:39, exp:4500, weak:"Fire", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:9500187, name:"Busted Doll", level:20, hp:20, mp:0, wAtk:90, mAtk:0, wDef:10, mDef:60, acc:55, avoid:1, exp:25, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300053, name:"Jr. Grupin in Tower of Goddess", level:51, hp:6400, mp:100, wAtk:145, mAtk:0, wDef:165, mDef:110, acc:115, avoid:20, exp:305, weak:"Fire", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9300305, name:"Sky Mushroom of the Maze III", level:10, hp:3, mp:10, wAtk:20, mAtk:0, wDef:10, mDef:10, acc:10, avoid:0, exp:1, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:3300005, name:"Grey Yeti and King Pepe", level:35, hp:120000, mp:10000, wAtk:125, mAtk:120, wDef:50, mDef:70, acc:80, avoid:15, exp:210, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9500115, name:"Lorang", level:37, hp:1950, mp:10, wAtk:125, mAtk:0, wDef:100, mDef:200, acc:85, avoid:18, exp:80, weak:"Lightning", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:2230108, name:"Pinboom", level:22, hp:400, mp:0, wAtk:100, mAtk:0, wDef:30, mDef:30, acc:55, avoid:7, exp:36, weak:"-", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:6130207, name:"Peach Monkey", level:62, hp:7500, mp:100, wAtk:185, mAtk:200, wDef:170, mDef:200, acc:200, avoid:25, exp:240, weak:"-", strong:"-", immune:"-", boss:false, location:"3 maps", undead:false, auto:true },
  { id:7120102, name:"Gatekeeper Nex", level:77, hp:114000, mp:150, wAtk:250, mAtk:350, wDef:250, mDef:250, acc:150, avoid:30, exp:330, weak:"-", strong:"-", immune:"-", boss:true, location:"1 map", undead:false, auto:true },
  { id:9500307, name:"Stumpy", level:35, hp:7000, mp:120, wAtk:125, mAtk:0, wDef:50, mDef:70, acc:80, avoid:12, exp:405, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9500188, name:"Destroyed Doll", level:20, hp:20, mp:0, wAtk:90, mAtk:0, wDef:10, mDef:60, acc:55, avoid:1, exp:25, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300052, name:"Jr. Lioner in Tower of Goddess", level:51, hp:6400, mp:100, wAtk:145, mAtk:0, wDef:165, mDef:110, acc:115, avoid:20, exp:305, weak:"Ice", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:8120102, name:"Afterlord", level:82, hp:29000, mp:100, wAtk:360, mAtk:390, wDef:690, mDef:455, acc:146, avoid:22, exp:1220, weak:"-", strong:"-", immune:"Poison", boss:false, location:"2 maps", undead:false, auto:true },
  { id:6400005, name:"주니어 발록", level:44, hp:50000, mp:500, wAtk:200, mAtk:400, wDef:420, mDef:450, acc:20, avoid:30, exp:10, weak:"Holy", strong:"-", immune:"Poison", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9300094, name:"Crimson Balrog the Kidnapper", level:100, hp:50000, mp:500, wAtk:400, mAtk:500, wDef:600, mDef:600, acc:180, avoid:40, exp:3500, weak:"Holy", strong:"-", immune:"Poison", boss:true, location:"1 map", undead:false, auto:true },
  { id:9300045, name:"Lunar Pixie in Tower of Goddess", level:54, hp:6600, mp:200, wAtk:155, mAtk:165, wDef:175, mDef:140, acc:122, avoid:21, exp:325, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9300089, name:"Phoenix", level:120, hp:1350000, mp:1500, wAtk:430, mAtk:480, wDef:780, mDef:850, acc:200, avoid:39, exp:13500, weak:"Ice", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9400623, name:"Amdusias", level:25, hp:2500, mp:150, wAtk:80, mAtk:90, wDef:50, mDef:60, acc:120, avoid:8, exp:60, weak:"-", strong:"-", immune:"-", boss:true, location:"1 map", undead:false, auto:true },
  { id:6220001, name:"Zeno", level:65, hp:36000, mp:300, wAtk:205, mAtk:0, wDef:210, mDef:200, acc:150, avoid:29, exp:940, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:4230502, name:"Black Porky", level:43, hp:2400, mp:150, wAtk:130, mAtk:0, wDef:130, mDef:160, acc:150, avoid:15, exp:103, weak:"-", strong:"-", immune:"-", boss:false, location:"3 maps", undead:false, auto:true },
  { id:9300377, name:"Witch Bear", level:110, hp:200000, mp:500, wAtk:480, mAtk:720, wDef:900, mDef:850, acc:200, avoid:40, exp:3000, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9400615, name:"Strange Ribbon Pig", level:10, hp:120, mp:45, wAtk:70, mAtk:0, wDef:10, mDef:30, acc:40, avoid:2, exp:20, weak:"-", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:5130108, name:"Miner Zombie", level:57, hp:4500, mp:110, wAtk:155, mAtk:185, wDef:165, mDef:180, acc:135, avoid:25, exp:190, weak:"Holy", strong:"-", immune:"Poison", boss:false, location:"4 maps", undead:true, auto:true },
  { id:9400610, name:"Amdusias", level:25, hp:2500, mp:150, wAtk:80, mAtk:90, wDef:50, mDef:60, acc:120, avoid:8, exp:60, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9500314, name:"King Sage Cat", level:77, hp:108000, mp:520, wAtk:320, mAtk:350, wDef:520, mDef:410, acc:160, avoid:27, exp:2280, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9300070, name:"Red Wyvern 2 in Cave", level:97, hp:53000, mp:210, wAtk:450, mAtk:500, wDef:830, mDef:550, acc:203, avoid:37, exp:800, weak:"Ice", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9420508, name:"Octobunny", level:43, hp:2150, mp:60, wAtk:100, mAtk:0, wDef:400, mDef:400, acc:100, avoid:18, exp:120, weak:"Poison", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9410002, name:"Angry Stray Dog", level:42, hp:2300, mp:30, wAtk:140, mAtk:150, wDef:160, mDef:110, acc:160, avoid:20, exp:102, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9200012, name:"Drake (PC)", level:50, hp:3200, mp:100, wAtk:165, mAtk:0, wDef:110, mDef:150, acc:75, avoid:18, exp:135, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300028, name:"Ergoth", level:115, hp:1700000, mp:150000, wAtk:700, mAtk:700, wDef:1100, mDef:1200, acc:230, avoid:18, exp:150000, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:true, auto:true },
  { id:5110300, name:"Reinforced Mithril Mutae ", level:50, hp:3000, mp:40, wAtk:140, mAtk:0, wDef:170, mDef:200, acc:80, avoid:15, exp:135, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9300055, name:"Star Pixie in Tower of Goddess(Summon Boss)", level:53, hp:6300, mp:200, wAtk:150, mAtk:160, wDef:170, mDef:120, acc:120, avoid:20, exp:320, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:8220012, name:"Oberon", level:90, hp:450000, mp:300, wAtk:550, mAtk:550, wDef:800, mDef:700, acc:185, avoid:37, exp:5500, weak:"-", strong:"-", immune:"-", boss:true, location:"1 map", undead:false, auto:true },
  { id:7130000, name:"Lucida", level:73, hp:15500, mp:240, wAtk:280, mAtk:315, wDef:300, mDef:320, acc:160, avoid:28, exp:320, weak:"Holy", strong:"-", immune:"Poison", boss:false, location:"4 maps", undead:false, auto:true },
  { id:9300000, name:"Jr. Necki (PC)", level:21, hp:320, mp:40, wAtk:100, mAtk:0, wDef:60, mDef:60, acc:240, avoid:15, exp:240, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9400580, name:"Elderwraith", level:95, hp:51000, mp:500, wAtk:560, mAtk:610, wDef:940, mDef:550, acc:200, avoid:38, exp:2480, weak:"Holy", strong:"-", immune:"Ice", boss:false, location:"9 maps", undead:true, auto:true },
  { id:9400000, name:"Crow", level:25, hp:550, mp:20, wAtk:90, mAtk:0, wDef:30, mDef:30, acc:50, avoid:10, exp:42, weak:"Lightning", strong:"-", immune:"-", boss:false, location:"3 maps", undead:false, auto:true },
  { id:9400240, name:"Roid ", level:54, hp:4400, mp:160, wAtk:155, mAtk:0, wDef:180, mDef:215, acc:150, avoid:18, exp:168, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:8810019, name:"Red Wyvern", level:97, hp:53000, mp:210, wAtk:450, mAtk:500, wDef:830, mDef:550, acc:203, avoid:37, exp:800, weak:"Ice", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9400210, name:"Coolie Zombie (JP)", level:57, hp:4700, mp:110, wAtk:170, mAtk:185, wDef:170, mDef:180, acc:135, avoid:23, exp:190, weak:"Holy", strong:"-", immune:"Poison", boss:false, location:"Location unknown", undead:true, auto:true },
  { id:9400571, name:"Headless Horseman", level:50, hp:4000, mp:200, wAtk:145, mAtk:0, wDef:255, mDef:205, acc:155, avoid:28, exp:160, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9400619, name:"Strange Zombie Mushroom", level:24, hp:500, mp:50, wAtk:95, mAtk:0, wDef:20, mDef:30, acc:50, avoid:8, exp:42, weak:"Holy", strong:"-", immune:"-", boss:false, location:"1 map", undead:true, auto:true },
  { id:5120505, name:"Reindeer", level:58, hp:5600, mp:200, wAtk:170, mAtk:205, wDef:180, mDef:210, acc:155, avoid:20, exp:205, weak:"Poison", strong:"-", immune:"-", boss:false, location:"4 maps", undead:false, auto:true },
  { id:9300252, name:"Reinforced Iron Mutae", level:45, hp:2550, mp:0, wAtk:135, mAtk:0, wDef:150, mDef:160, acc:200, avoid:20, exp:110, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9200005, name:"Slime (PC)", level:6, hp:50, mp:35, wAtk:42, mAtk:0, wDef:5, mDef:10, acc:35, avoid:1, exp:10, weak:"Lightning", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9400740, name:"MV Minion", level:140, hp:200000, mp:1000, wAtk:400, mAtk:200, wDef:500, mDef:1000, acc:210, avoid:50, exp:5000, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9500132, name:"Werewolf", level:75, hp:16000, mp:150, wAtk:330, mAtk:380, wDef:800, mDef:290, acc:160, avoid:25, exp:350, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:5100005, name:"Hogul", level:53, hp:4500, mp:160, wAtk:185, mAtk:0, wDef:185, mDef:215, acc:140, avoid:25, exp:165, weak:"Ice", strong:"-", immune:"-", boss:false, location:"6 maps", undead:false, auto:true },
  { id:8810020, name:"Blue Wyvern", level:101, hp:57000, mp:250, wAtk:495, mAtk:535, wDef:850, mDef:570, acc:205, avoid:38, exp:1000, weak:"Fire", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9600009, name:"Giant Centipede", level:50, hp:18000, mp:200, wAtk:320, mAtk:340, wDef:300, mDef:150, acc:150, avoid:27, exp:108, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:3230303, name:"Propelly", level:37, hp:1700, mp:0, wAtk:118, mAtk:0, wDef:95, mDef:115, acc:140, avoid:18, exp:82, weak:"-", strong:"-", immune:"-", boss:false, location:"3 maps", undead:false, auto:true },
  { id:8200004, name:"Chief Memory Guardian", level:101, hp:59000, mp:200, wAtk:500, mAtk:545, wDef:910, mDef:540, acc:205, avoid:37, exp:3100, weak:"-", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:8140102, name:"Red Kentaurus", level:88, hp:37000, mp:200, wAtk:390, mAtk:430, wDef:800, mDef:495, acc:170, avoid:28, exp:1600, weak:"Ice", strong:"-", immune:"-", boss:false, location:"6 maps", undead:false, auto:true },
  { id:9300203, name:"Jr. Balrog", level:80, hp:50000, mp:500, wAtk:450, mAtk:605, wDef:420, mDef:450, acc:150, avoid:30, exp:2000, weak:"Holy", strong:"-", immune:"Poison", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9400201, name:"Wild Cargo", level:62, hp:5500, mp:100, wAtk:210, mAtk:0, wDef:180, mDef:130, acc:100, avoid:20, exp:1, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9100013, name:"Adin ", level:30, hp:8000, mp:0, wAtk:100, mAtk:0, wDef:45, mDef:45, acc:60, avoid:10, exp:100, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9400517, name:"Magik Fierry A", level:40, hp:1930, mp:200, wAtk:120, mAtk:140, wDef:100, mDef:110, acc:155, avoid:32, exp:135, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:4300015, name:"Cheap Amplifier", level:48, hp:2800, mp:250, wAtk:160, mAtk:170, wDef:180, mDef:195, acc:140, avoid:22, exp:180, weak:"-", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:3230400, name:"Drumming Bunny", level:30, hp:950, mp:0, wAtk:100, mAtk:0, wDef:38, mDef:40, acc:65, avoid:12, exp:60, weak:"-", strong:"-", immune:"-", boss:false, location:"12 maps", undead:false, auto:true },
  { id:7130104, name:"Captain", level:70, hp:15000, mp:100, wAtk:210, mAtk:320, wDef:250, mDef:260, acc:165, avoid:26, exp:282, weak:"-", strong:"-", immune:"-", boss:false, location:"4 maps", undead:false, auto:true },
  { id:8170000, name:"Thanatos", level:108, hp:70000, mp:300, wAtk:510, mAtk:620, wDef:850, mDef:680, acc:210, avoid:38, exp:4100, weak:"Holy", strong:"-", immune:"-", boss:false, location:"1 map", undead:true, auto:true },
  { id:2230131, name:"Annoyed Zombie Mushroom", level:24, hp:500, mp:50, wAtk:95, mAtk:0, wDef:20, mDef:30, acc:50, avoid:8, exp:42, weak:"Holy", strong:"-", immune:"-", boss:false, location:"4 maps", undead:true, auto:true },
  { id:8810023, name:"Dark Cornian", level:105, hp:67000, mp:200, wAtk:495, mAtk:0, wDef:800, mDef:500, acc:205, avoid:45, exp:1200, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:5250002, name:"Primitive Boar", level:57, hp:4500, mp:100, wAtk:155, mAtk:0, wDef:170, mDef:160, acc:130, avoid:20, exp:200, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:100130, name:"Muru", level:1, hp:8, mp:0, wAtk:12, mAtk:0, wDef:0, mDef:0, acc:20, avoid:0, exp:1, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9500194, name:"Mirror Ghost", level:20, hp:350, mp:30, wAtk:1, mAtk:0, wDef:10, mDef:60, acc:999, avoid:999, exp:1, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9300240, name:"Ultra Gray", level:45, hp:2550, mp:170, wAtk:140, mAtk:155, wDef:180, mDef:200, acc:210, avoid:21, exp:110, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9420003, name:"Red Lizard", level:40, hp:1920, mp:120, wAtk:124, mAtk:0, wDef:110, mDef:130, acc:65, avoid:15, exp:95, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300275, name:"Yellow Snail of the Maze", level:10, hp:10, mp:10, wAtk:20, mAtk:0, wDef:10, mDef:10, acc:10, avoid:0, exp:1, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300287, name:"Snowman of Competence", level:90, hp:220000, mp:300, wAtk:450, mAtk:430, wDef:800, mDef:500, acc:195, avoid:38, exp:5200, weak:"-", strong:"-", immune:"-", boss:true, location:"1 map", undead:false, auto:true },
  { id:9500173, name:"Griffey", level:80, hp:205100, mp:1500, wAtk:165, mAtk:170, wDef:150, mDef:160, acc:170, avoid:0, exp:17200, weak:"Poison", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9400544, name:"Gryphon", level:50, hp:3300, mp:120, wAtk:190, mAtk:140, wDef:155, mDef:170, acc:175, avoid:23, exp:220, weak:"-", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:9400749, name:"Red Eggy Popp", level:50, hp:2150, mp:60, wAtk:145, mAtk:0, wDef:90, mDef:90, acc:300, avoid:12, exp:120, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:3230304, name:"Planey", level:38, hp:1830, mp:0, wAtk:122, mAtk:0, wDef:105, mDef:125, acc:150, avoid:19, exp:85, weak:"-", strong:"-", immune:"-", boss:false, location:"4 maps", undead:false, auto:true },
  { id:9300244, name:"Grizzly", level:56, hp:4800, mp:150, wAtk:165, mAtk:0, wDef:180, mDef:200, acc:135, avoid:18, exp:185, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9400644, name:"Malady", level:10, hp:1000, mp:10, wAtk:30, mAtk:20, wDef:100, mDef:120, acc:50, avoid:27, exp:100, weak:"Holy", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:7220001, name:"Nine-Tailed Fox", level:70, hp:89000, mp:200, wAtk:260, mAtk:310, wDef:280, mDef:265, acc:130, avoid:25, exp:1300, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9300134, name:"King Bloctopus", level:30, hp:3300, mp:0, wAtk:160, mAtk:0, wDef:210, mDef:210, acc:70, avoid:14, exp:135, weak:"-", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:4240000, name:"Chief Gray", level:49, hp:9000, mp:220, wAtk:140, mAtk:180, wDef:140, mDef:250, acc:140, avoid:25, exp:580, weak:"-", strong:"-", immune:"-", boss:false, location:"4 maps", undead:false, auto:true },
  { id:4230506, name:"Ginseng Jar", level:48, hp:2800, mp:100, wAtk:145, mAtk:0, wDef:165, mDef:170, acc:140, avoid:20, exp:123, weak:"-", strong:"-", immune:"-", boss:false, location:"4 maps", undead:false, auto:true },
  { id:9300204, name:"Eliza", level:83, hp:87000, mp:320, wAtk:420, mAtk:400, wDef:600, mDef:450, acc:150, avoid:30, exp:2800, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9300343, name:"Target Pig", level:7, hp:75, mp:40, wAtk:37, mAtk:0, wDef:5, mDef:20, acc:40, avoid:0, exp:15, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9300258, name:"Yeti", level:65, hp:11000, mp:80, wAtk:182, mAtk:270, wDef:170, mDef:245, acc:110, avoid:24, exp:255, weak:"Fire", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9400007, name:"Green Boogie", level:45, hp:2900, mp:170, wAtk:150, mAtk:225, wDef:100, mDef:225, acc:100, avoid:28, exp:120, weak:"Poison", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:4130102, name:"Dark Nependeath", level:47, hp:2700, mp:135, wAtk:145, mAtk:165, wDef:170, mDef:220, acc:165, avoid:15, exp:115, weak:"Holy", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:9400510, name:"Green Eggy Popp", level:35, hp:1250, mp:60, wAtk:120, mAtk:0, wDef:45, mDef:75, acc:65, avoid:10, exp:85, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300288, name:"Crimson Balrog of Competence ", level:90, hp:220000, mp:300, wAtk:450, mAtk:430, wDef:800, mDef:500, acc:195, avoid:38, exp:5200, weak:"Holy", strong:"-", immune:"Poison", boss:true, location:"1 map", undead:false, auto:true },
  { id:2100101, name:"Desert Rabbit (M)", level:21, hp:400, mp:0, wAtk:90, mAtk:0, wDef:25, mDef:30, acc:70, avoid:9, exp:34, weak:"-", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:9400640, name:"Twisted Jester", level:70, hp:50000, mp:200, wAtk:190, mAtk:190, wDef:140, mDef:140, acc:110, avoid:22, exp:1325, weak:"-", strong:"-", immune:"-", boss:false, location:"9 maps", undead:true, auto:true },
  { id:9500309, name:"King Clang", level:55, hp:25000, mp:200, wAtk:165, mAtk:175, wDef:120, mDef:120, acc:100, avoid:20, exp:1210, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9300037, name:"Mist Knight", level:66, hp:22000, mp:200, wAtk:250, mAtk:320, wDef:550, mDef:320, acc:145, avoid:25, exp:100, weak:"Holy", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:true, auto:true },
  { id:9500339, name:"Deo", level:38, hp:7700, mp:200, wAtk:130, mAtk:0, wDef:100, mDef:120, acc:130, avoid:18, exp:445, weak:"-", strong:"-", immune:"-", boss:true, location:"30 maps", undead:false, auto:true },
  { id:4220000, name:"Seruf", level:45, hp:7800, mp:150, wAtk:135, mAtk:155, wDef:150, mDef:200, acc:200, avoid:20, exp:330, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9001001, name:"Grendel the Really Old's Clone", level:80, hp:90000, mp:820, wAtk:170, mAtk:335, wDef:120, mDef:350, acc:100, avoid:10, exp:2400, weak:"-", strong:"-", immune:"-", boss:true, location:"1 map", undead:false, auto:true },
  { id:9300362, name:"Grii Gingerman", level:1, hp:10, mp:0, wAtk:0, mAtk:0, wDef:130, mDef:160, acc:120, avoid:18, exp:1, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9420004, name:"Yellow Lizard", level:25, hp:500, mp:55, wAtk:90, mAtk:0, wDef:20, mDef:30, acc:50, avoid:8, exp:46, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:5100002, name:"Firebomb", level:51, hp:3600, mp:42, wAtk:145, mAtk:0, wDef:255, mDef:205, acc:155, avoid:28, exp:142, weak:"Ice", strong:"-", immune:"-", boss:false, location:"6 maps", undead:false, auto:true },
  { id:9500193, name:"Fire Steed", level:100, hp:10, mp:40, wAtk:40, mAtk:0, wDef:5, mDef:10, acc:40, avoid:1, exp:12, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300115, name:"Lord Pirate's Enraged Kru", level:59, hp:2820, mp:100, wAtk:155, mAtk:240, wDef:350, mDef:250, acc:130, avoid:23, exp:70, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9300212, name:"Griffey", level:105, hp:3700000, mp:1500, wAtk:550, mAtk:680, wDef:900, mDef:850, acc:200, avoid:39, exp:13500, weak:"Poison", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9300136, name:"Rombot", level:30, hp:6500, mp:220, wAtk:167, mAtk:180, wDef:220, mDef:220, acc:95, avoid:12, exp:450, weak:"-", strong:"-", immune:"-", boss:true, location:"2 maps", undead:false, auto:true },
  { id:9500154, name:"Coketump Lite", level:30, hp:930, mp:20, wAtk:100, mAtk:0, wDef:45, mDef:45, acc:65, avoid:12, exp:56, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9500101, name:"Pig", level:7, hp:75, mp:40, wAtk:52, mAtk:0, wDef:5, mDef:20, acc:40, avoid:0, exp:15, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9410004, name:"Biker Monkey", level:47, hp:2800, mp:50, wAtk:150, mAtk:0, wDef:180, mDef:200, acc:130, avoid:18, exp:117, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:7130601, name:"Green Hobi", level:76, hp:18000, mp:200, wAtk:300, mAtk:350, wDef:400, mDef:350, acc:170, avoid:28, exp:370, weak:"-", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:9420533, name:"Rodeo", level:61, hp:6000, mp:150, wAtk:220, mAtk:50, wDef:220, mDef:230, acc:110, avoid:28, exp:235, weak:"Ice", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:9420534, name:"Charmer", level:65, hp:9800, mp:100, wAtk:180, mAtk:230, wDef:180, mDef:240, acc:130, avoid:24, exp:255, weak:"Ice", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:3300006, name:"Gold Yeti and King Pepe", level:35, hp:120000, mp:10000, wAtk:125, mAtk:120, wDef:50, mDef:70, acc:80, avoid:15, exp:210, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9300146, name:"Cyti", level:76, hp:38000, mp:240, wAtk:230, mAtk:260, wDef:190, mDef:400, acc:130, avoid:26, exp:360, weak:"-", strong:"-", immune:"-", boss:false, location:"2 maps", undead:true, auto:true },
  { id:9500141, name:"Separated Yeti", level:65, hp:11000, mp:80, wAtk:182, mAtk:270, wDef:170, mDef:245, acc:110, avoid:24, exp:455, weak:"Fire", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:6090001, name:"Snow Witch", level:64, hp:7700, mp:200, wAtk:177, mAtk:230, wDef:190, mDef:230, acc:140, avoid:999, exp:10320, weak:"-", strong:"-", immune:"-", boss:true, location:"3 maps", undead:false, auto:true },
  { id:9300255, name:"Mithril Mutae", level:47, hp:23000, mp:240, wAtk:250, mAtk:200, wDef:290, mDef:300, acc:130, avoid:20, exp:300, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300339, name:"Space Mateon", level:15, hp:200000, mp:10000, wAtk:1, mAtk:1, wDef:99999, mDef:99999, acc:999, avoid:0, exp:5, weak:"-", strong:"-", immune:"-", boss:true, location:"1 map", undead:false, auto:true },
  { id:5220003, name:"Timer", level:59, hp:21000, mp:200, wAtk:200, mAtk:205, wDef:180, mDef:230, acc:150, avoid:20, exp:650, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9300265, name:"Blue Wyvern", level:101, hp:57000, mp:250, wAtk:495, mAtk:535, wDef:850, mDef:570, acc:205, avoid:38, exp:3050, weak:"Fire", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:2100100, name:"Desert Rabbit (F)", level:20, hp:350, mp:0, wAtk:85, mAtk:0, wDef:20, mDef:20, acc:55, avoid:8, exp:32, weak:"-", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:9300197, name:"Zeno", level:65, hp:36000, mp:300, wAtk:205, mAtk:0, wDef:210, mDef:200, acc:150, avoid:29, exp:940, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9400202, name:"Golden Slime", level:1, hp:100, mp:35, wAtk:1, mAtk:1, wDef:400, mDef:400, acc:35, avoid:1, exp:1, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:5220000, name:"King Clang", level:55, hp:25000, mp:200, wAtk:165, mAtk:175, wDef:120, mDef:120, acc:100, avoid:20, exp:1210, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:3300002, name:"Intoxicated Pig", level:31, hp:810, mp:0, wAtk:88, mAtk:0, wDef:25, mDef:45, acc:65, avoid:11, exp:68, weak:"-", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:9400320, name:"Cross (Medium)", level:45, hp:7500, mp:200, wAtk:170, mAtk:118, wDef:120, mDef:85, acc:80, avoid:25, exp:1000, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9400516, name:"Crystal Boar", level:40, hp:1900, mp:60, wAtk:145, mAtk:0, wDef:50, mDef:45, acc:65, avoid:15, exp:90, weak:"Fire", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:9500337, name:"Mano", level:20, hp:2000, mp:30, wAtk:90, mAtk:0, wDef:20, mDef:30, acc:60, avoid:8, exp:120, weak:"-", strong:"-", immune:"-", boss:true, location:"30 maps", undead:false, auto:true },
  { id:9400596, name:"Scarlet Phoenix", level:120, hp:5000000, mp:5000000, wAtk:600, mAtk:500, wDef:800, mDef:900, acc:200, avoid:45, exp:250000, weak:"Ice", strong:"-", immune:"Fire", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9300230, name:"Platoon Chronos", level:41, hp:2050, mp:50, wAtk:125, mAtk:142, wDef:130, mDef:160, acc:145, avoid:22, exp:99, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:true, auto:true },
  { id:9500112, name:"Jr. Pepe", level:35, hp:1400, mp:70, wAtk:130, mAtk:0, wDef:110, mDef:100, acc:105, avoid:18, exp:75, weak:"Fire", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9420005, name:"White Rooster", level:15, hp:230, mp:25, wAtk:82, mAtk:0, wDef:11, mDef:40, acc:45, avoid:5, exp:28, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9420538, name:"Booper Scarlion", level:82, hp:28000, mp:200, wAtk:360, mAtk:400, wDef:680, mDef:480, acc:150, avoid:29, exp:1250, weak:"Fire", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9400004, name:"Big Cloud Fox", level:45, hp:2600, mp:60, wAtk:145, mAtk:0, wDef:125, mDef:175, acc:180, avoid:20, exp:110, weak:"Lightning", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:9500151, name:"Coke Slime", level:15, hp:240, mp:10, wAtk:80, mAtk:0, wDef:40, mDef:50, acc:80, avoid:10, exp:26, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9400706, name:"Jr. MV", level:8, hp:2000, mp:100, wAtk:250, mAtk:250, wDef:100, mDef:100, acc:1000, avoid:25, exp:10, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:8220000, name:"Eliza", level:83, hp:87000, mp:320, wAtk:420, mAtk:400, wDef:600, mDef:450, acc:150, avoid:30, exp:2800, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:6400000, name:"Dark Yeti", level:68, hp:13000, mp:100, wAtk:210, mAtk:290, wDef:190, mDef:270, acc:130, avoid:26, exp:265, weak:"Holy", strong:"-", immune:"-", boss:false, location:"3 maps", undead:false, auto:true },
  { id:8140500, name:"Bain", level:90, hp:45000, mp:190, wAtk:425, mAtk:465, wDef:835, mDef:505, acc:195, avoid:38, exp:1800, weak:"Ice", strong:"-", immune:"-", boss:false, location:"3 maps", undead:false, auto:true },
  { id:9300245, name:"Panda", level:60, hp:6500, mp:100, wAtk:180, mAtk:0, wDef:200, mDef:230, acc:150, avoid:22, exp:225, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300202, name:"King Sage Cat", level:77, hp:108000, mp:520, wAtk:320, mAtk:350, wDef:520, mDef:410, acc:160, avoid:27, exp:2280, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9500124, name:"Mushmom", level:60, hp:20000, mp:200, wAtk:200, mAtk:300, wDef:320, mDef:320, acc:150, avoid:27, exp:1200, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9400632, name:"Event Pink Bean", level:70, hp:2000000, mp:1000, wAtk:370, mAtk:350, wDef:1200, mDef:1100, acc:270, avoid:5, exp:30000, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9300262, name:"Red Kentaurus", level:88, hp:37000, mp:200, wAtk:390, mAtk:430, wDef:800, mDef:495, acc:170, avoid:28, exp:1600, weak:"Ice", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300001, name:"Ligator (PC)", level:32, hp:1000, mp:80, wAtk:110, mAtk:0, wDef:90, mDef:80, acc:140, avoid:10, exp:120, weak:"Fire", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9300324, name:"Viking", level:69, hp:12500, mp:170, wAtk:220, mAtk:320, wDef:250, mDef:220, acc:135, avoid:27, exp:10, weak:"Lightning", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9500346, name:"Dyle", level:65, hp:31000, mp:200, wAtk:190, mAtk:200, wDef:190, mDef:220, acc:150, avoid:30, exp:810, weak:"-", strong:"-", immune:"-", boss:true, location:"30 maps", undead:false, auto:true },
  { id:9300188, name:"Giant Centipede", level:50, hp:18000, mp:200, wAtk:320, mAtk:340, wDef:300, mDef:150, acc:150, avoid:27, exp:1080, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9200009, name:"Stone Golem (PC)", level:55, hp:4000, mp:120, wAtk:180, mAtk:0, wDef:130, mDef:100, acc:80, avoid:15, exp:170, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:3210208, name:"Retz", level:36, hp:1400, mp:0, wAtk:120, mAtk:0, wDef:90, mDef:85, acc:100, avoid:18, exp:78, weak:"-", strong:"-", immune:"-", boss:false, location:"3 maps", undead:false, auto:true },
  { id:4230110, name:"King Block Golem", level:45, hp:2600, mp:0, wAtk:150, mAtk:0, wDef:130, mDef:110, acc:105, avoid:14, exp:110, weak:"-", strong:"-", immune:"-", boss:false, location:"3 maps", undead:false, auto:true },
  { id:9300127, name:"Brown Teddy", level:30, hp:1800, mp:0, wAtk:155, mAtk:0, wDef:70, mDef:150, acc:75, avoid:16, exp:110, weak:"-", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:9400642, name:"Olivia", level:50, hp:210000, mp:200, wAtk:180, mAtk:200, wDef:245, mDef:265, acc:130, avoid:23, exp:6950, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9400747, name:"Bain Minion", level:170, hp:4500000, mp:1900, wAtk:700, mAtk:650, wDef:750, mDef:500, acc:210, avoid:70, exp:25000, weak:"Ice", strong:"-", immune:"-", boss:true, location:"1 map", undead:false, auto:true },
  { id:9200008, name:"Blue Mushroom (PC)", level:20, hp:350, mp:30, wAtk:90, mAtk:0, wDef:10, mDef:60, acc:55, avoid:7, exp:32, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:6130104, name:"Boogie", level:35, hp:14800, mp:500, wAtk:180, mAtk:300, wDef:250, mDef:300, acc:250, avoid:35, exp:400, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300139, name:"Frankenroid", level:81, hp:660000, mp:2500, wAtk:400, mAtk:400, wDef:700, mDef:990, acc:170, avoid:28, exp:12000, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9300358, name:"Grii Gingerman", level:1, hp:10, mp:0, wAtk:0, mAtk:0, wDef:30, mDef:40, acc:65, avoid:8, exp:1, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9500177, name:"Giant Centipede", level:50, hp:20692, mp:200, wAtk:70, mAtk:65, wDef:10, mDef:0, acc:150, avoid:0, exp:1780, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9300063, name:"Stirge", level:6, hp:60, mp:20, wAtk:22, mAtk:0, wDef:5, mDef:20, acc:40, avoid:3, exp:22, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9400003, name:"Nightghost", level:60, hp:7100, mp:100, wAtk:165, mAtk:0, wDef:200, mDef:220, acc:160, avoid:25, exp:220, weak:"Holy", strong:"-", immune:"-", boss:false, location:"2 maps", undead:true, auto:true },
  { id:7120109, name:"Iruvata", level:79, hp:23500, mp:200, wAtk:340, mAtk:385, wDef:625, mDef:450, acc:170, avoid:30, exp:750, weak:"-", strong:"-", immune:"Poison", boss:false, location:"2 maps", undead:false, auto:true },
  { id:9400560, name:"Sophilia Doll", level:50, hp:1800, mp:150, wAtk:140, mAtk:130, wDef:170, mDef:170, acc:120, avoid:19, exp:115, weak:"-", strong:"-", immune:"-", boss:false, location:"4 maps", undead:false, auto:true },
  { id:4230117, name:"Zeta Gray", level:42, hp:2300, mp:55, wAtk:130, mAtk:150, wDef:160, mDef:180, acc:190, avoid:20, exp:102, weak:"-", strong:"-", immune:"-", boss:false, location:"3 maps", undead:false, auto:true },
  { id:9420513, name:"Capt. Latanica", level:100, hp:2000000, mp:100000, wAtk:500, mAtk:700, wDef:700, mDef:900, acc:160, avoid:12, exp:210000, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9200003, name:"Horned Mushroom (PC)", level:22, hp:300, mp:35, wAtk:90, mAtk:0, wDef:30, mDef:0, acc:55, avoid:7, exp:35, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9500150, name:"Ice Golem", level:60, hp:6900, mp:120, wAtk:200, mAtk:0, wDef:200, mDef:210, acc:150, avoid:24, exp:221, weak:"Fire", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300122, name:"Lord Pirate's Furious Captain", level:62, hp:10440, mp:100, wAtk:180, mAtk:270, wDef:250, mDef:380, acc:165, avoid:26, exp:198, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:6400007, name:"Baby Balrog", level:48, hp:2800, mp:500, wAtk:135, mAtk:0, wDef:65, mDef:1200, acc:180, avoid:1, exp:10, weak:"Holy", strong:"-", immune:"Poison", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:8220001, name:"Snowman", level:90, hp:120000, mp:300, wAtk:450, mAtk:430, wDef:800, mDef:500, acc:195, avoid:38, exp:5200, weak:"-", strong:"-", immune:"-", boss:true, location:"1 map", undead:false, auto:true },
  { id:9500139, name:"Jr. Balrog", level:80, hp:50000, mp:500, wAtk:450, mAtk:605, wDef:420, mDef:450, acc:150, avoid:30, exp:2000, weak:"Holy", strong:"-", immune:"Poison", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9400607, name:"Cake Monster", level:15, hp:250, mp:25, wAtk:82, mAtk:0, wDef:12, mDef:40, acc:45, avoid:5, exp:30, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:8220009, name:"Snack Bar", level:85, hp:110000, mp:1000, wAtk:480, mAtk:520, wDef:720, mDef:660, acc:190, avoid:35, exp:3180, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9400617, name:"Strange Pig", level:7, hp:75, mp:40, wAtk:37, mAtk:0, wDef:5, mDef:20, acc:40, avoid:0, exp:15, weak:"-", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:8120104, name:"Maverick Type A", level:86, hp:32000, mp:180, wAtk:375, mAtk:430, wDef:700, mDef:465, acc:160, avoid:27, exp:1560, weak:"-", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:9300022, name:"Black Knight", level:66, hp:40000, mp:200, wAtk:250, mAtk:320, wDef:550, mDef:320, acc:145, avoid:25, exp:1060, weak:"Holy", strong:"-", immune:"-", boss:false, location:"1 map", undead:true, auto:true },
  { id:9500308, name:"Faust", level:50, hp:9800, mp:100, wAtk:165, mAtk:0, wDef:110, mDef:150, acc:100, avoid:20, exp:410, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9400641, name:"Olivia", level:30, hp:50000, mp:200, wAtk:160, mAtk:180, wDef:160, mDef:180, acc:120, avoid:11, exp:2711, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9500111, name:"Jr. Wraith", level:35, hp:1200, mp:80, wAtk:110, mAtk:0, wDef:90, mDef:90, acc:100, avoid:17, exp:70, weak:"Holy", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:true, auto:true },
  { id:3400008, name:"Transformed Doll Claw Game", level:39, hp:1800, mp:100, wAtk:130, mAtk:135, wDef:125, mDef:115, acc:115, avoid:19, exp:110, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9500373, name:"Machine MT-09", level:20, hp:600, mp:170, wAtk:170, mAtk:180, wDef:280, mDef:280, acc:140, avoid:20, exp:980, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9500358, name:"Crimson Balrog", level:100, hp:100000, mp:500, wAtk:500, mAtk:720, wDef:800, mDef:800, acc:180, avoid:40, exp:3500, weak:"Holy", strong:"-", immune:"Poison", boss:true, location:"30 maps", undead:false, auto:true },
  { id:4230118, name:"Ultra Gray", level:45, hp:2550, mp:170, wAtk:140, mAtk:155, wDef:180, mDef:200, acc:210, avoid:21, exp:110, weak:"-", strong:"-", immune:"-", boss:false, location:"3 maps", undead:false, auto:true },
  { id:9500161, name:"Hankie", level:80, hp:27000, mp:300, wAtk:350, mAtk:410, wDef:650, mDef:450, acc:140, avoid:28, exp:850, weak:"Poison", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:7130002, name:"Beetle", level:72, hp:15200, mp:120, wAtk:272, mAtk:310, wDef:335, mDef:265, acc:175, avoid:30, exp:295, weak:"-", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:9400513, name:"Candle Mob (2nd) ", level:10, hp:250, mp:10, wAtk:70, mAtk:0, wDef:20, mDef:10, acc:45, avoid:0, exp:20, weak:"Ice", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300257, name:"Transforming Doll Machine  (After)", level:60, hp:6000, mp:400, wAtk:210, mAtk:225, wDef:180, mDef:190, acc:155, avoid:20, exp:280, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:3230308, name:"Tweeter", level:39, hp:1900, mp:0, wAtk:130, mAtk:0, wDef:120, mDef:130, acc:135, avoid:17, exp:85, weak:"-", strong:"-", immune:"-", boss:false, location:"3 maps", undead:false, auto:true },
  { id:9500366, name:"Barnard Gray", level:15, hp:380, mp:130, wAtk:120, mAtk:140, wDef:140, mDef:160, acc:170, avoid:18, exp:95, weak:"Lightning", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9410010, name:"Jr. Pepe UFO Catcher", level:50, hp:3800, mp:50, wAtk:175, mAtk:160, wDef:160, mDef:210, acc:152, avoid:20, exp:135, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:7120104, name:"Silver Slime", level:71, hp:15100, mp:100, wAtk:260, mAtk:320, wDef:260, mDef:263, acc:170, avoid:30, exp:346, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:6130101, name:"Mushmom", level:60, hp:20000, mp:200, wAtk:200, mAtk:300, wDef:320, mDef:320, acc:150, avoid:27, exp:1200, weak:"-", strong:"-", immune:"-", boss:true, location:"1 map", undead:false, auto:true },
  { id:7130103, name:"Commander Skeleton", level:73, hp:15300, mp:200, wAtk:275, mAtk:300, wDef:330, mDef:300, acc:190, avoid:32, exp:315, weak:"Holy", strong:"-", immune:"Poison", boss:false, location:"2 maps", undead:true, auto:true },
  { id:8220010, name:"Dunas", level:81, hp:300000, mp:350, wAtk:410, mAtk:400, wDef:700, mDef:440, acc:155, avoid:30, exp:3800, weak:"-", strong:"-", immune:"Poison", boss:true, location:"1 map", undead:false, auto:true },
  { id:5150001, name:"Skeleton Soldier", level:57, hp:4600, mp:100, wAtk:165, mAtk:165, wDef:160, mDef:160, acc:135, avoid:25, exp:190, weak:"Holy", strong:"-", immune:"-", boss:false, location:"5 maps", undead:true, auto:true },
  { id:9410015, name:"Snack Bar", level:85, hp:230000, mp:1000, wAtk:480, mAtk:520, wDef:720, mDef:660, acc:200, avoid:40, exp:4230, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9500165, name:"Red Kentaurus", level:88, hp:37000, mp:200, wAtk:390, mAtk:430, wDef:800, mDef:495, acc:170, avoid:28, exp:1600, weak:"Ice", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300073, name:"Dark Wyvern 1 in Cave", level:103, hp:60000, mp:250, wAtk:505, mAtk:540, wDef:900, mDef:580, acc:205, avoid:38, exp:1050, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:8110300, name:"Homunscullo", level:80, hp:27000, mp:300, wAtk:350, mAtk:410, wDef:650, mDef:450, acc:140, avoid:28, exp:850, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9300224, name:"Black Sheep", level:37, hp:1500, mp:100, wAtk:115, mAtk:125, wDef:100, mDef:115, acc:90, avoid:18, exp:79, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300151, name:"Frankenroid", level:81, hp:660000, mp:2500, wAtk:400, mAtk:400, wDef:700, mDef:990, acc:170, avoid:28, exp:12000, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9500129, name:"Taurospear", level:70, hp:15000, mp:200, wAtk:270, mAtk:320, wDef:250, mDef:250, acc:120, avoid:15, exp:270, weak:"-", strong:"-", immune:"Poison", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9500156, name:"Wraith", level:48, hp:2800, mp:80, wAtk:155, mAtk:0, wDef:180, mDef:180, acc:130, avoid:20, exp:120, weak:"Holy", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:true, auto:true },
  { id:8150100, name:"Shark", level:100, hp:56000, mp:230, wAtk:490, mAtk:530, wDef:850, mDef:570, acc:205, avoid:38, exp:3000, weak:"-", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:9300294, name:"Advanced Pianus", level:100, hp:560000, mp:500, wAtk:500, mAtk:550, wDef:800, mDef:800, acc:180, avoid:40, exp:3500, weak:"Fire", strong:"-", immune:"-", boss:true, location:"1 map", undead:false, auto:true },
  { id:9500117, name:"Helly", level:36, hp:1350, mp:0, wAtk:115, mAtk:0, wDef:85, mDef:105, acc:130, avoid:17, exp:77, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300220, name:"Axe Stump", level:17, hp:300, mp:30, wAtk:85, mAtk:0, wDef:30, mDef:10, acc:50, avoid:5, exp:30, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9500148, name:"Igloo Turtle", level:45, hp:2600, mp:0, wAtk:150, mAtk:0, wDef:130, mDef:130, acc:110, avoid:18, exp:110, weak:"Fire", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9500343, name:"Alishar", level:56, hp:125000, mp:2500, wAtk:280, mAtk:260, wDef:210, mDef:240, acc:160, avoid:26, exp:4800, weak:"-", strong:"-", immune:"-", boss:true, location:"30 maps", undead:false, auto:true },
  { id:9500127, name:"Master Soul Teddy", level:67, hp:11000, mp:100, wAtk:210, mAtk:220, wDef:210, mDef:250, acc:140, avoid:27, exp:265, weak:"Holy", strong:"-", immune:"Ice", boss:false, location:"Location unknown", undead:true, auto:true },
  { id:9300300, name:"Blue Ribbon Pig of the Maze", level:10, hp:10, mp:10, wAtk:20, mAtk:0, wDef:10, mDef:10, acc:10, avoid:0, exp:1, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9400616, name:"Strange Green Mushroom", level:15, hp:250, mp:25, wAtk:82, mAtk:0, wDef:12, mDef:40, acc:45, avoid:5, exp:26, weak:"-", strong:"-", immune:"Poison", boss:false, location:"2 maps", undead:false, auto:true },
  { id:9200021, name:"Separated Yetti", level:65, hp:11000, mp:80, wAtk:182, mAtk:270, wDef:170, mDef:245, acc:110, avoid:24, exp:455, weak:"Fire", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9500372, name:"Plateon", level:15, hp:500, mp:0, wAtk:140, mAtk:0, wDef:140, mDef:190, acc:170, avoid:18, exp:105, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300217, name:"Blue Snail", level:2, hp:15, mp:15, wAtk:17, mAtk:0, wDef:0, mDef:0, acc:20, avoid:0, exp:4, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9500315, name:"Eliza", level:83, hp:87000, mp:320, wAtk:420, mAtk:400, wDef:600, mDef:450, acc:150, avoid:30, exp:2800, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9600003, name:"Sheep", level:25, hp:550, mp:50, wAtk:95, mAtk:0, wDef:20, mDef:30, acc:50, avoid:8, exp:42, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:3230305, name:"Toy Trojan", level:39, hp:1920, mp:0, wAtk:124, mAtk:0, wDef:110, mDef:130, acc:135, avoid:18, exp:92, weak:"-", strong:"-", immune:"-", boss:false, location:"5 maps", undead:false, auto:true },
  { id:9300148, name:"Neo Huroid", level:79, hp:24000, mp:240, wAtk:260, mAtk:260, wDef:400, mDef:450, acc:155, avoid:20, exp:330, weak:"-", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:100133, name:"Murumuru", level:7, hp:70, mp:0, wAtk:36, mAtk:0, wDef:5, mDef:20, acc:40, avoid:0, exp:15, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:4230121, name:"Mecateon", level:46, hp:2600, mp:170, wAtk:135, mAtk:158, wDef:160, mDef:210, acc:180, avoid:20, exp:110, weak:"-", strong:"-", immune:"-", boss:false, location:"6 maps", undead:false, auto:true },
  { id:8150201, name:"Dark Cornian", level:105, hp:67000, mp:200, wAtk:495, mAtk:0, wDef:800, mDef:500, acc:205, avoid:45, exp:3700, weak:"-", strong:"-", immune:"-", boss:false, location:"5 maps", undead:false, auto:true },
  { id:9300011, name:"Toy Trojan", level:39, hp:1920, mp:0, wAtk:124, mAtk:0, wDef:110, mDef:130, acc:135, avoid:18, exp:92, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300322, name:"Ghost Pirate", level:65, hp:10500, mp:150, wAtk:200, mAtk:280, wDef:220, mDef:200, acc:125, avoid:25, exp:8, weak:"Fire", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9500335, name:"Frankenroid", level:50, hp:30000, mp:255, wAtk:140, mAtk:160, wDef:170, mDef:200, acc:80, avoid:15, exp:675, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9400656, name:"Strange Ribbon Pig", level:10, hp:120, mp:45, wAtk:70, mAtk:0, wDef:10, mDef:30, acc:40, avoid:2, exp:20, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:4230113, name:"Tick-Tock", level:40, hp:1900, mp:50, wAtk:120, mAtk:0, wDef:160, mDef:170, acc:115, avoid:20, exp:95, weak:"-", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:9500140, name:"Crimson Balrog", level:100, hp:100000, mp:500, wAtk:500, mAtk:720, wDef:800, mDef:800, acc:180, avoid:40, exp:3500, weak:"Holy", strong:"-", immune:"Poison", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9410006, name:"Yellow Bubble Tea", level:38, hp:1900, mp:100, wAtk:120, mAtk:135, wDef:105, mDef:120, acc:140, avoid:15, exp:88, weak:"Poison", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300048, name:"Nependeath in Tower of Goddess", level:59, hp:10000, mp:200, wAtk:170, mAtk:180, wDef:180, mDef:180, acc:130, avoid:25, exp:430, weak:"Fire", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:6230201, name:"Separated Dark Pepe", level:64, hp:7800, mp:80, wAtk:177, mAtk:0, wDef:220, mDef:240, acc:210, avoid:31, exp:700, weak:"Holy", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9500318, name:"Angry Snowman", level:40, hp:4500, mp:20, wAtk:10, mAtk:10, wDef:10, mDef:10, acc:-20, avoid:1, exp:85, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:4250000, name:"Mossy Snail", level:42, hp:2400, mp:100, wAtk:130, mAtk:0, wDef:110, mDef:100, acc:120, avoid:12, exp:102, weak:"-", strong:"-", immune:"-", boss:false, location:"3 maps", undead:false, auto:true },
  { id:9500317, name:"Kid Snowman", level:10, hp:3000, mp:20, wAtk:10, mAtk:10, wDef:10, mDef:10, acc:-25, avoid:1, exp:20, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9400203, name:"Silver Slime", level:40, hp:800, mp:100, wAtk:50, mAtk:0, wDef:800, mDef:800, acc:75, avoid:18, exp:20000, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:4130104, name:"Dark Nependeath", level:47, hp:2700, mp:135, wAtk:145, mAtk:165, wDef:170, mDef:220, acc:165, avoid:15, exp:115, weak:"Holy", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:6300002, name:"Separated Yeti", level:65, hp:11000, mp:80, wAtk:182, mAtk:270, wDef:170, mDef:245, acc:110, avoid:24, exp:455, weak:"Fire", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300206, name:"Chimera", level:85, hp:96000, mp:350, wAtk:430, mAtk:430, wDef:700, mDef:465, acc:160, avoid:27, exp:3000, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:8140103, name:"Blue Kentaurus", level:88, hp:37000, mp:200, wAtk:390, mAtk:430, wDef:800, mDef:495, acc:170, avoid:28, exp:1600, weak:"Fire", strong:"-", immune:"-", boss:false, location:"6 maps", undead:false, auto:true },
  { id:9300276, name:"Green Snail of the Maze", level:10, hp:10, mp:10, wAtk:20, mAtk:0, wDef:10, mDef:10, acc:10, avoid:0, exp:1, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:2230200, name:"Flower Fish", level:29, hp:790, mp:0, wAtk:110, mAtk:0, wDef:80, mDef:85, acc:75, avoid:10, exp:58, weak:"Ice", strong:"-", immune:"-", boss:false, location:"3 maps", undead:false, auto:true },
  { id:3220000, name:"Stumpy", level:35, hp:7000, mp:120, wAtk:125, mAtk:0, wDef:50, mDef:70, acc:80, avoid:12, exp:405, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:8200006, name:"Qualm Monk Trainee", level:109, hp:79000, mp:250, wAtk:530, mAtk:600, wDef:700, mDef:800, acc:210, avoid:38, exp:3600, weak:"Fire", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:4110301, name:"Reinforced Iron Mutae", level:45, hp:2550, mp:0, wAtk:135, mAtk:0, wDef:150, mDef:160, acc:200, avoid:20, exp:110, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:4300003, name:"Yellow Perfume", level:41, hp:1900, mp:210, wAtk:135, mAtk:145, wDef:155, mDef:165, acc:115, avoid:19, exp:115, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9500311, name:"Dyle", level:65, hp:31000, mp:200, wAtk:190, mAtk:200, wDef:190, mDef:220, acc:150, avoid:30, exp:810, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9410009, name:"Yeti Doll", level:36, hp:1550, mp:35, wAtk:120, mAtk:0, wDef:90, mDef:90, acc:120, avoid:10, exp:81, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9500367, name:"Zeta Gray", level:15, hp:400, mp:55, wAtk:130, mAtk:150, wDef:160, mDef:180, acc:190, avoid:20, exp:102, weak:"Lightning", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300132, name:"Tick-Tock", level:30, hp:2400, mp:50, wAtk:157, mAtk:0, wDef:210, mDef:210, acc:80, avoid:15, exp:117, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9500341, name:"Faust", level:50, hp:9800, mp:100, wAtk:165, mAtk:0, wDef:110, mDef:150, acc:100, avoid:20, exp:410, weak:"-", strong:"-", immune:"-", boss:true, location:"30 maps", undead:false, auto:true },
  { id:9200014, name:"Wild Kargo (PC)", level:62, hp:5500, mp:100, wAtk:210, mAtk:0, wDef:180, mDef:130, acc:100, avoid:20, exp:240, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300236, name:"Luster Pixie", level:56, hp:7200, mp:200, wAtk:160, mAtk:170, wDef:180, mDef:160, acc:124, avoid:22, exp:355, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:8140700, name:"Blue Dragon Turtle", level:90, hp:40000, mp:150, wAtk:410, mAtk:0, wDef:820, mDef:480, acc:195, avoid:37, exp:1780, weak:"Fire", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:9200007, name:"Zombie Lupin (PC)", level:40, hp:1800, mp:100, wAtk:120, mAtk:135, wDef:70, mDef:70, acc:110, avoid:25, exp:90, weak:"Holy", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:true, auto:true },
  { id:9400638, name:"Rotting Skeleton", level:20, hp:850, mp:0, wAtk:95, mAtk:0, wDef:60, mDef:50, acc:80, avoid:12, exp:74, weak:"Holy", strong:"-", immune:"Poison", boss:false, location:"8 maps", undead:true, auto:true },
  { id:9500168, name:"King Slime", level:20, hp:945, mp:30, wAtk:45, mAtk:45, wDef:10, mDef:20, acc:140, avoid:0, exp:182, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9300143, name:"Reinforced Iron Mutae", level:73, hp:20000, mp:240, wAtk:280, mAtk:200, wDef:290, mDef:300, acc:200, avoid:20, exp:300, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:7120103, name:"Red Slime", level:70, hp:15000, mp:100, wAtk:210, mAtk:320, wDef:250, mDef:260, acc:165, avoid:26, exp:338, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9400002, name:"Cloud Fox", level:30, hp:920, mp:50, wAtk:98, mAtk:0, wDef:80, mDef:70, acc:60, avoid:12, exp:55, weak:"Fire", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:9420535, name:"Jester Scarlion", level:68, hp:12000, mp:180, wAtk:230, mAtk:210, wDef:200, mDef:220, acc:160, avoid:27, exp:270, weak:"-", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:9300241, name:"Kru", level:68, hp:12500, mp:100, wAtk:200, mAtk:290, wDef:190, mDef:250, acc:130, avoid:26, exp:265, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300286, name:"Dangerous Blue Mushroom", level:20, hp:350, mp:30, wAtk:80, mAtk:0, wDef:10, mDef:60, acc:55, avoid:7, exp:32, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9500135, name:"Death Teddy", level:85, hp:32000, mp:180, wAtk:375, mAtk:430, wDef:700, mDef:465, acc:160, avoid:27, exp:1300, weak:"Holy", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:true, auto:true },
  { id:9400213, name:"Dark Jr. Yeti (JP)", level:56, hp:4400, mp:40, wAtk:160, mAtk:0, wDef:185, mDef:190, acc:130, avoid:27, exp:180, weak:"Holy", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9500344, name:"Timer", level:59, hp:21000, mp:200, wAtk:200, mAtk:205, wDef:180, mDef:230, acc:150, avoid:20, exp:650, weak:"-", strong:"-", immune:"-", boss:true, location:"30 maps", undead:false, auto:true },
  { id:9400518, name:"Magik Fierry B", level:30, hp:800, mp:175, wAtk:80, mAtk:0, wDef:85, mDef:105, acc:145, avoid:25, exp:120, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9400211, name:"Dark Stone Golem (JP)", level:58, hp:4800, mp:150, wAtk:200, mAtk:0, wDef:155, mDef:200, acc:100, avoid:18, exp:200, weak:"Holy", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:4230600, name:"Desert Giant ", level:40, hp:1800, mp:100, wAtk:120, mAtk:0, wDef:160, mDef:160, acc:150, avoid:17, exp:95, weak:"Fire", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:9400603, name:"Angry Strawberry Cake", level:40, hp:1300, mp:50, wAtk:125, mAtk:0, wDef:50, mDef:50, acc:130, avoid:13, exp:100, weak:"Poison", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9500110, name:"Star Pixie", level:35, hp:1300, mp:100, wAtk:120, mAtk:130, wDef:100, mDef:100, acc:145, avoid:21, exp:72, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9200015, name:"Brown Tanny", level:30, hp:950, mp:0, wAtk:100, mAtk:0, wDef:38, mDef:40, acc:65, avoid:12, exp:60, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9500312, name:"Nine-Tailed Fox", level:70, hp:89000, mp:200, wAtk:260, mAtk:310, wDef:280, mDef:265, acc:130, avoid:25, exp:1300, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9300068, name:"Dark Cornian 2 in Cave", level:105, hp:67000, mp:200, wAtk:495, mAtk:0, wDef:800, mDef:500, acc:205, avoid:45, exp:1200, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9400239, name:"Sand Rat", level:24, hp:600, mp:0, wAtk:95, mAtk:0, wDef:35, mDef:40, acc:55, avoid:10, exp:55, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:3110101, name:"Pink Teddy", level:32, hp:1050, mp:0, wAtk:105, mAtk:0, wDef:50, mDef:70, acc:80, avoid:14, exp:65, weak:"-", strong:"-", immune:"-", boss:false, location:"10 maps", undead:false, auto:true },
  { id:9500104, name:"Octopus", level:12, hp:200, mp:50, wAtk:82, mAtk:0, wDef:10, mDef:40, acc:40, avoid:4, exp:24, weak:"Lightning", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300008, name:"Shadow Eye from Another Dimension", level:43, hp:7100, mp:0, wAtk:130, mAtk:0, wDef:470, mDef:70, acc:120, avoid:18, exp:340, weak:"-", strong:"-", immune:"-", boss:false, location:"3 maps", undead:false, auto:true },
  { id:3300001, name:"Poison Mushroom", level:30, hp:780, mp:0, wAtk:80, mAtk:0, wDef:25, mDef:32, acc:65, avoid:10, exp:65, weak:"-", strong:"-", immune:"-", boss:false, location:"5 maps", undead:false, auto:true },
  { id:9500192, name:"Pumpkin Knight", level:100, hp:10, mp:10, wAtk:40, mAtk:0, wDef:5, mDef:10, acc:40, avoid:1, exp:12, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300060, name:"Iron Hog", level:42, hp:1100, mp:60, wAtk:85, mAtk:0, wDef:60, mDef:40, acc:100, avoid:5, exp:296, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:8140701, name:"Red Dragon Turtle", level:93, hp:49000, mp:160, wAtk:420, mAtk:0, wDef:830, mDef:500, acc:200, avoid:37, exp:2100, weak:"Ice", strong:"-", immune:"-", boss:false, location:"3 maps", undead:false, auto:true },
  { id:9300058, name:"Pig", level:7, hp:75, mp:40, wAtk:52, mAtk:0, wDef:5, mDef:20, acc:40, avoid:0, exp:15, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9300140, name:"Angry Frankenroid", level:84, hp:850000, mp:2500, wAtk:440, mAtk:440, wDef:800, mDef:990, acc:190, avoid:33, exp:25000, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:5120506, name:"The Book Ghost", level:55, hp:4500, mp:150, wAtk:155, mAtk:0, wDef:150, mDef:220, acc:150, avoid:20, exp:175, weak:"-", strong:"-", immune:"-", boss:false, location:"3 maps", undead:false, auto:true },
  { id:9420505, name:"Tippo Blue", level:53, hp:3200, mp:100, wAtk:160, mAtk:0, wDef:110, mDef:150, acc:75, avoid:18, exp:140, weak:"Fire", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9400585, name:"Crimson Tree", level:75, hp:3500, mp:50, wAtk:140, mAtk:0, wDef:150, mDef:200, acc:150, avoid:10, exp:122, weak:"Fire", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300169, name:"Ratz from Another Dimension", level:32, hp:3700, mp:0, wAtk:112, mAtk:0, wDef:85, mDef:95, acc:80, avoid:13, exp:260, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9500368, name:"Ultra Gray", level:15, hp:420, mp:170, wAtk:140, mAtk:155, wDef:180, mDef:200, acc:210, avoid:21, exp:110, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9400102, name:"Extra C", level:50, hp:3100, mp:50, wAtk:150, mAtk:0, wDef:185, mDef:170, acc:148, avoid:20, exp:148, weak:"Poison", strong:"-", immune:"-", boss:false, location:"3 maps", undead:false, auto:true },
  { id:8140600, name:"Bone Fish", level:92, hp:42500, mp:190, wAtk:420, mAtk:460, wDef:840, mDef:540, acc:197, avoid:38, exp:2000, weak:"Holy", strong:"-", immune:"-", boss:false, location:"2 maps", undead:true, auto:true },
  { id:9400008, name:"Black Boogie", level:65, hp:7980, mp:220, wAtk:180, mAtk:220, wDef:270, mDef:250, acc:145, avoid:32, exp:325, weak:"Ice", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:6230601, name:"Dark Drake", level:68, hp:13000, mp:140, wAtk:220, mAtk:250, wDef:205, mDef:250, acc:170, avoid:27, exp:265, weak:"-", strong:"-", immune:"-", boss:false, location:"3 maps", undead:false, auto:true },
  { id:9600006, name:"Cow", level:33, hp:1200, mp:0, wAtk:110, mAtk:0, wDef:50, mDef:40, acc:60, avoid:12, exp:66, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9500170, name:"Papa Pixie", level:45, hp:8925, mp:500, wAtk:105, mAtk:100, wDef:40, mDef:40, acc:160, avoid:0, exp:543, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9300334, name:"Chief Gray", level:49, hp:9000, mp:220, wAtk:140, mAtk:180, wDef:140, mDef:250, acc:140, avoid:25, exp:580, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:6300000, name:"Yeti", level:65, hp:11000, mp:80, wAtk:182, mAtk:270, wDef:170, mDef:245, acc:110, avoid:24, exp:255, weak:"Fire", strong:"-", immune:"-", boss:false, location:"3 maps", undead:false, auto:true },
  { id:2110301, name:"Scorpion", level:29, hp:780, mp:0, wAtk:100, mAtk:0, wDef:40, mDef:45, acc:60, avoid:10, exp:58, weak:"-", strong:"-", immune:"-", boss:false, location:"3 maps", undead:false, auto:true },
  { id:7140000, name:"Ghost Pirate", level:83, hp:30000, mp:160, wAtk:365, mAtk:400, wDef:710, mDef:460, acc:150, avoid:27, exp:1100, weak:"Fire", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9420510, name:"Slimy", level:63, hp:5800, mp:100, wAtk:200, mAtk:0, wDef:190, mDef:150, acc:100, avoid:20, exp:250, weak:"Holy", strong:"-", immune:"-", boss:false, location:"2 maps", undead:true, auto:true },
  { id:9400101, name:"Extra B", level:47, hp:2800, mp:50, wAtk:150, mAtk:0, wDef:140, mDef:110, acc:143, avoid:18, exp:139, weak:"Poison", strong:"-", immune:"-", boss:false, location:"4 maps", undead:false, auto:true },
  { id:6110301, name:"Saitie", level:68, hp:13000, mp:100, wAtk:210, mAtk:290, wDef:190, mDef:270, acc:130, avoid:26, exp:265, weak:"-", strong:"-", immune:"-", boss:false, location:"3 maps", undead:true, auto:true },
  { id:9300082, name:"Stirge", level:6, hp:60, mp:20, wAtk:22, mAtk:0, wDef:5, mDef:20, acc:40, avoid:3, exp:22, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9500359, name:"Manon", level:105, hp:3700000, mp:1500, wAtk:550, mAtk:680, wDef:900, mDef:850, acc:200, avoid:39, exp:13500, weak:"Ice", strong:"-", immune:"-", boss:true, location:"30 maps", undead:false, auto:true },
  { id:9300364, name:"Sma Gingerman", level:1, hp:10, mp:0, wAtk:0, mAtk:0, wDef:640, mDef:570, acc:150, avoid:21, exp:1, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9500353, name:"Jr. Balrog", level:80, hp:50000, mp:500, wAtk:450, mAtk:605, wDef:420, mDef:450, acc:150, avoid:30, exp:2000, weak:"Holy", strong:"-", immune:"Poison", boss:true, location:"30 maps", undead:false, auto:true },
  { id:9400005, name:"Red Boogie", level:15, hp:275, mp:100, wAtk:88, mAtk:0, wDef:22, mDef:0, acc:50, avoid:9, exp:30, weak:"Fire", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9400249, name:"Roid ", level:54, hp:4400, mp:160, wAtk:155, mAtk:0, wDef:180, mDef:215, acc:150, avoid:18, exp:168, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:100131, name:"Murupa", level:3, hp:28, mp:0, wAtk:21, mAtk:0, wDef:0, mDef:0, acc:30, avoid:0, exp:6, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9300336, name:"Mecateon", level:46, hp:2600, mp:170, wAtk:135, mAtk:158, wDef:160, mDef:210, acc:180, avoid:20, exp:110, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:2100104, name:"Royal Cactus", level:28, hp:750, mp:0, wAtk:105, mAtk:0, wDef:40, mDef:40, acc:60, avoid:10, exp:55, weak:"Fire", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:9300359, name:"Sma Gingerman", level:1, hp:10, mp:0, wAtk:0, mAtk:0, wDef:40, mDef:70, acc:75, avoid:10, exp:1, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:8810021, name:"Dark Wyvern", level:103, hp:80000, mp:1000, wAtk:505, mAtk:540, wDef:900, mDef:580, acc:205, avoid:38, exp:1050, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:4230500, name:"Chipmunk", level:40, hp:1900, mp:125, wAtk:110, mAtk:0, wDef:135, mDef:100, acc:150, avoid:15, exp:95, weak:"-", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:9300067, name:"Dark Cornian 1 in Cave", level:105, hp:67000, mp:200, wAtk:495, mAtk:0, wDef:800, mDef:500, acc:205, avoid:45, exp:1200, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9500203, name:"Zoo Pig", level:7, hp:10000, mp:40, wAtk:0, mAtk:0, wDef:5, mDef:20, acc:40, avoid:0, exp:10, weak:"-", strong:"-", immune:"-", boss:true, location:"1 map", undead:false, auto:true },
  { id:8150300, name:"Red Wyvern", level:97, hp:53000, mp:210, wAtk:450, mAtk:500, wDef:830, mDef:550, acc:203, avoid:37, exp:2500, weak:"Ice", strong:"-", immune:"-", boss:false, location:"5 maps", undead:false, auto:true },
  { id:9500369, name:"Chief Gray", level:15, hp:520, mp:220, wAtk:140, mAtk:180, wDef:140, mDef:250, acc:140, avoid:25, exp:580, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9400579, name:"Nightshadow", level:100, hp:70000, mp:200, wAtk:480, mAtk:610, wDef:800, mDef:560, acc:210, avoid:45, exp:3600, weak:"-", strong:"-", immune:"Ice", boss:false, location:"7 maps", undead:false, auto:true },
  { id:9500167, name:"Golden Pig", level:10, hp:120, mp:45, wAtk:70, mAtk:0, wDef:10, mDef:30, acc:40, avoid:2, exp:20, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9409001, name:"Tutorial Drumming Rabbit", level:1, hp:8, mp:15, wAtk:20, mAtk:0, wDef:0, mDef:0, acc:30, avoid:0, exp:1, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9300373, name:"Witch Bear", level:70, hp:31000, mp:200, wAtk:160, mAtk:200, wDef:190, mDef:220, acc:150, avoid:30, exp:810, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9400505, name:"Turkey", level:6, hp:50, mp:35, wAtk:42, mAtk:0, wDef:5, mDef:10, acc:35, avoid:1, exp:11, weak:"Lightning", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9400709, name:"Snowman2", level:50, hp:162000, mp:500, wAtk:105, mAtk:100, wDef:40, mDef:40, acc:160, avoid:0, exp:543, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9500354, name:"Frankenroid", level:81, hp:660000, mp:2500, wAtk:400, mAtk:400, wDef:700, mDef:990, acc:170, avoid:28, exp:12000, weak:"-", strong:"-", immune:"-", boss:true, location:"30 maps", undead:false, auto:true },
  { id:9400209, name:"Miner Zombie (JP)", level:57, hp:4500, mp:110, wAtk:160, mAtk:185, wDef:170, mDef:180, acc:135, avoid:25, exp:190, weak:"Holy", strong:"-", immune:"Poison", boss:false, location:"Location unknown", undead:true, auto:true },
  { id:9420539, name:"Vikerola", level:87, hp:36000, mp:150, wAtk:388, mAtk:430, wDef:820, mDef:465, acc:160, avoid:26, exp:2000, weak:"Fire", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9500109, name:"Ratz", level:32, hp:1000, mp:0, wAtk:102, mAtk:0, wDef:65, mDef:75, acc:90, avoid:13, exp:65, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9500159, name:"Blue King Goblin", level:70, hp:25000, mp:200, wAtk:285, mAtk:335, wDef:280, mDef:280, acc:120, avoid:15, exp:400, weak:"Fire", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9400605, name:"Chocolate Cake", level:60, hp:4400, mp:25, wAtk:150, mAtk:0, wDef:125, mDef:125, acc:155, avoid:5, exp:200, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9300003, name:"King Slime", level:40, hp:8000, mp:100, wAtk:130, mAtk:165, wDef:160, mDef:160, acc:140, avoid:10, exp:800, weak:"-", strong:"-", immune:"-", boss:true, location:"1 map", undead:false, auto:true },
  { id:4230103, name:"Iron Hog", level:42, hp:2200, mp:60, wAtk:95, mAtk:0, wDef:400, mDef:400, acc:100, avoid:18, exp:99, weak:"-", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:6300001, name:"Transformed Yeti", level:65, hp:11000, mp:80, wAtk:182, mAtk:270, wDef:170, mDef:245, acc:110, avoid:24, exp:390, weak:"Fire", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:8200012, name:"Chief Oblivion Guardian", level:131, hp:141000, mp:360, wAtk:645, mAtk:725, wDef:1060, mDef:680, acc:230, avoid:47, exp:7060, weak:"Poison", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:6400006, name:"Crimson Balrog", level:44, hp:50000, mp:500, wAtk:200, mAtk:400, wDef:420, mDef:450, acc:20, avoid:30, exp:10, weak:"Holy", strong:"-", immune:"Poison", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9300292, name:"Advanced Griffey", level:100, hp:560000, mp:500, wAtk:500, mAtk:550, wDef:800, mDef:800, acc:180, avoid:40, exp:3500, weak:"Poison", strong:"-", immune:"-", boss:true, location:"1 map", undead:false, auto:true },
  { id:9400564, name:"Mirror Ghost", level:100, hp:1000000, mp:1000000, wAtk:200, mAtk:200, wDef:0, mDef:0, acc:999, avoid:999, exp:1, weak:"-", strong:"-", immune:"-", boss:false, location:"4 maps", undead:false, auto:true },
  { id:9300114, name:"Lord Pirate's Enraged Mr. Alli", level:58, hp:2700, mp:100, wAtk:150, mAtk:180, wDef:190, mDef:230, acc:140, avoid:18, exp:68, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:4230503, name:"Blue Flower Serpent", level:45, hp:2550, mp:0, wAtk:135, mAtk:0, wDef:170, mDef:150, acc:200, avoid:20, exp:110, weak:"-", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:9300043, name:"Lioner in Tower of Goddess", level:57, hp:7300, mp:200, wAtk:165, mAtk:175, wDef:190, mDef:170, acc:125, avoid:22, exp:370, weak:"Ice", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:8190002, name:"Nest Golem", level:110, hp:80000, mp:240, wAtk:580, mAtk:650, wDef:900, mDef:600, acc:210, avoid:38, exp:8050, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300310, name:"Sand Rabbit of the Maze", level:10, hp:10, mp:10, wAtk:20, mAtk:0, wDef:10, mDef:10, acc:10, avoid:0, exp:1, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9300178, name:"Poison Golem Level 3", level:65, hp:6700, mp:100, wAtk:160, mAtk:190, wDef:170, mDef:245, acc:135, avoid:0, exp:255, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9400713, name:"Item Killer", level:10, hp:120, mp:45, wAtk:70, mAtk:0, wDef:10, mDef:30, acc:40, avoid:2, exp:20, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9500175, name:"Angry Lord Pirate", level:60, hp:54600, mp:300, wAtk:115, mAtk:120, wDef:95, mDef:90, acc:140, avoid:0, exp:2430, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:4300006, name:"Kid Mannequin", level:43, hp:2300, mp:0, wAtk:140, mAtk:0, wDef:160, mDef:170, acc:120, avoid:20, exp:122, weak:"-", strong:"-", immune:"-", boss:false, location:"3 maps", undead:false, auto:true },
  { id:9300370, name:"Witch Bear", level:40, hp:7700, mp:200, wAtk:110, mAtk:0, wDef:100, mDef:120, acc:130, avoid:18, exp:445, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9400649, name:"Possessed Rabbit Doll", level:30, hp:1950, mp:100, wAtk:100, mAtk:0, wDef:38, mDef:80, acc:65, avoid:12, exp:60, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300307, name:"Sky Mushroom of the Maze V", level:10, hp:3, mp:10, wAtk:20, mAtk:0, wDef:10, mDef:10, acc:10, avoid:0, exp:1, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9300221, name:"Cactus", level:25, hp:550, mp:0, wAtk:95, mAtk:0, wDef:35, mDef:40, acc:55, avoid:9, exp:47, weak:"Fire", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300280, name:"Transforming Yellow Snail of the Maze", level:10, hp:10, mp:10, wAtk:20, mAtk:0, wDef:10, mDef:10, acc:10, avoid:0, exp:1, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9400621, name:"Strange Horny Mushroom", level:22, hp:300, mp:35, wAtk:90, mAtk:0, wDef:30, mDef:0, acc:55, avoid:7, exp:35, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9300049, name:"Royal Nependeath in Tower of Goddess", level:59, hp:10000, mp:200, wAtk:170, mAtk:180, wDef:180, mDef:180, acc:130, avoid:25, exp:430, weak:"Fire", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9600007, name:"Plow Ox", level:38, hp:1800, mp:0, wAtk:120, mAtk:0, wDef:105, mDef:120, acc:100, avoid:20, exp:86, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:8141300, name:"Squid", level:94, hp:46000, mp:190, wAtk:430, mAtk:485, wDef:830, mDef:525, acc:200, avoid:37, exp:2200, weak:"-", strong:"-", immune:"-", boss:false, location:"3 maps", undead:false, auto:true },
  { id:9500329, name:"Papa Pixie", level:40, hp:19300, mp:200, wAtk:120, mAtk:140, wDef:140, mDef:160, acc:170, avoid:13, exp:475, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9300303, name:"Sky Mushroom of the Maze I", level:10, hp:3, mp:10, wAtk:20, mAtk:0, wDef:10, mDef:10, acc:10, avoid:0, exp:1, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:4230125, name:"Skeledog", level:44, hp:2450, mp:0, wAtk:140, mAtk:0, wDef:170, mDef:190, acc:120, avoid:18, exp:107, weak:"Holy", strong:"-", immune:"-", boss:false, location:"3 maps", undead:true, auto:true },
  { id:9400572, name:"Geist Balrog", level:60, hp:7000, mp:1000, wAtk:190, mAtk:220, wDef:240, mDef:210, acc:210, avoid:28, exp:230, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9500202, name:"Zoo White Fang", level:58, hp:10000, mp:100, wAtk:0, mAtk:0, wDef:200, mDef:220, acc:150, avoid:25, exp:10, weak:"Fire", strong:"-", immune:"-", boss:true, location:"1 map", undead:false, auto:true },
  { id:7120101, name:"Gatekeeper Nex", level:73, hp:102000, mp:150, wAtk:250, mAtk:350, wDef:250, mDef:250, acc:150, avoid:30, exp:330, weak:"-", strong:"-", immune:"-", boss:true, location:"1 map", undead:false, auto:true },
  { id:9400636, name:"Black Cat", level:5, hp:500, mp:10, wAtk:10, mAtk:10, wDef:10, mDef:10, acc:10, avoid:10, exp:10, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9600008, name:"Black Sheep", level:37, hp:1500, mp:100, wAtk:115, mAtk:125, wDef:100, mDef:115, acc:90, avoid:18, exp:79, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9400100, name:"Extra A", level:45, hp:2800, mp:50, wAtk:140, mAtk:0, wDef:145, mDef:125, acc:140, avoid:22, exp:130, weak:"Poison", strong:"-", immune:"-", boss:false, location:"4 maps", undead:false, auto:true },
  { id:6400009, name:"Crimson Balrog", level:55, hp:28000, mp:500, wAtk:180, mAtk:240, wDef:420, mDef:450, acc:180, avoid:30, exp:10, weak:"Holy", strong:"-", immune:"Poison", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:3110303, name:"Triple Rumo", level:38, hp:1850, mp:0, wAtk:125, mAtk:0, wDef:105, mDef:125, acc:130, avoid:18, exp:85, weak:"-", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:9300363, name:"Grii Gingerman", level:1, hp:10, mp:0, wAtk:0, mAtk:0, wDef:220, mDef:300, acc:140, avoid:20, exp:1, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:7130402, name:"Green King Goblin", level:70, hp:25000, mp:200, wAtk:285, mAtk:335, wDef:280, mDef:280, acc:120, avoid:15, exp:400, weak:"-", strong:"-", immune:"Poison", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9300042, name:"Grupin in Tower of Goddess", level:57, hp:7300, mp:200, wAtk:165, mAtk:175, wDef:190, mDef:330, acc:125, avoid:22, exp:370, weak:"Fire", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9300088, name:"Dark Lord's Disciple", level:80, hp:120000, mp:510, wAtk:260, mAtk:0, wDef:260, mDef:220, acc:180, avoid:32, exp:2400, weak:"-", strong:"-", immune:"-", boss:true, location:"1 map", undead:false, auto:true },
  { id:8140510, name:"Gatekeeper Nex", level:90, hp:150000, mp:150, wAtk:250, mAtk:350, wDef:250, mDef:250, acc:150, avoid:30, exp:330, weak:"-", strong:"-", immune:"-", boss:true, location:"1 map", undead:false, auto:true },
  { id:9500342, name:"King Clang", level:55, hp:25000, mp:200, wAtk:165, mAtk:175, wDef:120, mDef:120, acc:100, avoid:20, exp:1210, weak:"-", strong:"-", immune:"-", boss:true, location:"30 maps", undead:false, auto:true },
  { id:9500176, name:"Blue Mushmom", level:60, hp:50400, mp:190, wAtk:85, mAtk:75, wDef:35, mDef:25, acc:160, avoid:0, exp:2260, weak:"Fire", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:8190003, name:"Skelegon", level:110, hp:80000, mp:240, wAtk:520, mAtk:660, wDef:800, mDef:700, acc:210, avoid:38, exp:4500, weak:"Holy", strong:"-", immune:"-", boss:false, location:"3 maps", undead:true, auto:true },
  { id:4300001, name:"Blue Perfume", level:40, hp:1800, mp:200, wAtk:130, mAtk:140, wDef:150, mDef:160, acc:110, avoid:18, exp:110, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9410005, name:"Red Bubble Tea", level:38, hp:1900, mp:100, wAtk:120, mAtk:135, wDef:105, mDef:120, acc:140, avoid:15, exp:88, weak:"Ice", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:6130203, name:"Panda", level:60, hp:6500, mp:100, wAtk:180, mAtk:0, wDef:200, mDef:230, acc:150, avoid:22, exp:225, weak:"-", strong:"-", immune:"-", boss:false, location:"3 maps", undead:false, auto:true },
  { id:8180001, name:"Griffey", level:105, hp:3700000, mp:1500, wAtk:550, mAtk:680, wDef:900, mDef:850, acc:200, avoid:39, exp:13500, weak:"Poison", strong:"-", immune:"-", boss:true, location:"2 maps", undead:false, auto:true },
  { id:9300366, name:"Grii Gingerman ", level:1, hp:10, mp:0, wAtk:0, mAtk:0, wDef:980, mDef:1450, acc:170, avoid:23, exp:1, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9300199, name:"Nine-Tailed Fox", level:70, hp:89000, mp:200, wAtk:260, mAtk:310, wDef:280, mDef:265, acc:130, avoid:25, exp:1300, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9500138, name:"Bain", level:90, hp:45000, mp:190, wAtk:425, mAtk:465, wDef:835, mDef:505, acc:195, avoid:38, exp:1800, weak:"Ice", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9200011, name:"Evil Eye (PC)", level:27, hp:720, mp:40, wAtk:100, mAtk:0, wDef:35, mDef:70, acc:60, avoid:10, exp:50, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300074, name:"Dark Wyvern 2 in Cave", level:103, hp:60000, mp:250, wAtk:505, mAtk:540, wDef:900, mDef:580, acc:205, avoid:38, exp:1050, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:6130103, name:"Pepe", level:60, hp:7200, mp:100, wAtk:167, mAtk:0, wDef:210, mDef:225, acc:200, avoid:30, exp:220, weak:"Fire", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9300120, name:"Lord Pirate's Furious Mr. Alli", level:59, hp:8820, mp:100, wAtk:160, mAtk:180, wDef:190, mDef:230, acc:140, avoid:23, exp:180, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9400647, name:"A Parasite", level:15, hp:200, mp:20, wAtk:60, mAtk:0, wDef:10, mDef:10, acc:45, avoid:5, exp:25, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:8120106, name:"Maverick Type D", level:89, hp:40000, mp:190, wAtk:400, mAtk:450, wDef:750, mDef:480, acc:180, avoid:28, exp:2064, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9300318, name:"Master Soul Teddy", level:57, hp:6500, mp:110, wAtk:160, mAtk:200, wDef:160, mDef:160, acc:105, avoid:21, exp:4, weak:"Holy", strong:"-", immune:"Ice", boss:true, location:"1 map", undead:false, auto:true },
  { id:8190005, name:"Nest Golem", level:110, hp:80000, mp:240, wAtk:580, mAtk:650, wDef:900, mDef:600, acc:210, avoid:38, exp:4450, weak:"-", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:4230122, name:"Nependeath", level:42, hp:2100, mp:120, wAtk:135, mAtk:145, wDef:120, mDef:120, acc:150, avoid:10, exp:99, weak:"Fire", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:2110300, name:"Sand Rat", level:24, hp:600, mp:0, wAtk:95, mAtk:0, wDef:35, mDef:40, acc:55, avoid:10, exp:55, weak:"-", strong:"-", immune:"-", boss:false, location:"4 maps", undead:false, auto:true },
  { id:9300150, name:"Neo Huroid", level:80, hp:35000, mp:240, wAtk:265, mAtk:265, wDef:290, mDef:310, acc:155, avoid:20, exp:390, weak:"-", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:9300289, name:"Snipe of Competence ", level:90, hp:220000, mp:3000, wAtk:450, mAtk:430, wDef:800, mDef:500, acc:195, avoid:38, exp:5200, weak:"-", strong:"-", immune:"-", boss:true, location:"1 map", undead:false, auto:true },
  { id:9400612, name:"Marbas", level:25, hp:2500, mp:150, wAtk:80, mAtk:90, wDef:50, mDef:60, acc:120, avoid:8, exp:60, weak:"-", strong:"-", immune:"-", boss:true, location:"1 map", undead:false, auto:true },
  { id:9400742, name:"Mummy Guard Dog", level:140, hp:140000, mp:0, wAtk:440, mAtk:0, wDef:770, mDef:700, acc:180, avoid:30, exp:6000, weak:"Holy", strong:"-", immune:"-", boss:false, location:"1 map", undead:true, auto:true },
  { id:9400541, name:"Killa Bee", level:25, hp:730, mp:45, wAtk:105, mAtk:0, wDef:40, mDef:75, acc:65, avoid:5, exp:60, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9500102, name:"Orange Mushroom", level:8, hp:80, mp:45, wAtk:52, mAtk:0, wDef:0, mDef:10, acc:42, avoid:1, exp:15, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:4230505, name:"Jar", level:47, hp:2700, mp:100, wAtk:140, mAtk:0, wDef:155, mDef:160, acc:130, avoid:18, exp:117, weak:"-", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:4230124, name:"Freezer", level:42, hp:2300, mp:150, wAtk:130, mAtk:150, wDef:120, mDef:160, acc:170, avoid:20, exp:102, weak:"-", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:9300254, name:"Reinforced Iron Mutae", level:73, hp:20000, mp:240, wAtk:280, mAtk:200, wDef:290, mDef:300, acc:200, avoid:20, exp:300, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300361, name:"Grii Gingerman", level:1, hp:10, mp:0, wAtk:0, mAtk:0, wDef:70, mDef:120, acc:150, avoid:14, exp:1, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:7090000, name:"Security Camera", level:75, hp:150000, mp:500, wAtk:300, mAtk:380, wDef:550, mDef:290, acc:130, avoid:110, exp:350, weak:"-", strong:"-", immune:"-", boss:true, location:"1 map", undead:true, auto:true },
  { id:3210203, name:"Panda Teddy", level:36, hp:1400, mp:0, wAtk:120, mAtk:0, wDef:95, mDef:95, acc:100, avoid:16, exp:77, weak:"-", strong:"-", immune:"-", boss:false, location:"9 maps", undead:false, auto:true },
  { id:6300004, name:"Pachu", level:66, hp:38000, mp:600, wAtk:300, mAtk:420, wDef:250, mDef:400, acc:150, avoid:35, exp:200, weak:"-", strong:"-", immune:"Fire", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:5120500, name:"Grizzly", level:56, hp:4800, mp:150, wAtk:165, mAtk:0, wDef:180, mDef:200, acc:135, avoid:18, exp:185, weak:"-", strong:"-", immune:"-", boss:false, location:"3 maps", undead:false, auto:true },
  { id:9400739, name:"MV Minion", level:140, hp:200000, mp:1000, wAtk:200, mAtk:400, wDef:1000, mDef:500, acc:210, avoid:45, exp:5000, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:8190004, name:"Skelosaurus", level:113, hp:85000, mp:250, wAtk:530, mAtk:670, wDef:810, mDef:710, acc:210, avoid:38, exp:4750, weak:"Holy", strong:"-", immune:"-", boss:false, location:"4 maps", undead:true, auto:true },
  { id:5220004, name:"Giant Centipede", level:50, hp:15000, mp:200, wAtk:180, mAtk:200, wDef:150, mDef:150, acc:150, avoid:27, exp:425, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9420531, name:"Scaredy Scarlion", level:59, hp:5800, mp:200, wAtk:210, mAtk:200, wDef:180, mDef:200, acc:130, avoid:25, exp:220, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9300235, name:"Croko", level:52, hp:3800, mp:75, wAtk:172, mAtk:0, wDef:120, mDef:80, acc:80, avoid:20, exp:170, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300261, name:"Black Kentaurus", level:88, hp:37000, mp:200, wAtk:390, mAtk:430, wDef:800, mDef:495, acc:170, avoid:28, exp:1600, weak:"Holy", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:true, auto:true },
  { id:9300173, name:"Poisoned Stone Bug", level:65, hp:7200, mp:100, wAtk:160, mAtk:190, wDef:170, mDef:245, acc:135, avoid:0, exp:255, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9400583, name:"Leprechaun", level:45, hp:2800, mp:0, wAtk:135, mAtk:0, wDef:150, mDef:160, acc:200, avoid:20, exp:135, weak:"Holy", strong:"-", immune:"Ice", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9420503, name:"Nospeed", level:33, hp:1000, mp:60, wAtk:110, mAtk:0, wDef:40, mDef:40, acc:60, avoid:10, exp:60, weak:"-", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:9300239, name:"Zeta", level:42, hp:2300, mp:55, wAtk:130, mAtk:150, wDef:160, mDef:180, acc:190, avoid:20, exp:102, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9400537, name:"Geist Balrog Phase 2", level:100, hp:300000, mp:500, wAtk:230, mAtk:400, wDef:500, mDef:450, acc:180, avoid:40, exp:1100, weak:"Holy", strong:"-", immune:"Poison", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:8140511, name:"Imperial Guard", level:91, hp:43000, mp:170, wAtk:430, mAtk:460, wDef:650, mDef:670, acc:190, avoid:37, exp:2280, weak:"-", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:9300170, name:"Black Ratz from Another Dimension", level:34, hp:4300, mp:0, wAtk:125, mAtk:0, wDef:95, mDef:95, acc:90, avoid:14, exp:280, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9500166, name:"Blue Kentaurus", level:88, hp:37000, mp:200, wAtk:390, mAtk:430, wDef:800, mDef:495, acc:170, avoid:28, exp:1600, weak:"Fire", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9500143, name:"Coke Pig", level:35, hp:1400, mp:0, wAtk:120, mAtk:0, wDef:100, mDef:130, acc:110, avoid:16, exp:72, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9500126, name:"Ice Drake", level:64, hp:7700, mp:130, wAtk:210, mAtk:230, wDef:200, mDef:230, acc:150, avoid:25, exp:250, weak:"Fire", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9500325, name:"King Slime", level:23, hp:5000, mp:100, wAtk:85, mAtk:110, wDef:35, mDef:45, acc:55, avoid:9, exp:210, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9420529, name:"Dark Fission", level:52, hp:3700, mp:150, wAtk:155, mAtk:170, wDef:120, mDef:255, acc:120, avoid:20, exp:172, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:8190000, name:"Jr. Newtie", level:105, hp:68000, mp:200, wAtk:500, mAtk:550, wDef:750, mDef:680, acc:205, avoid:38, exp:3800, weak:"-", strong:"-", immune:"-", boss:false, location:"3 maps", undead:false, auto:true },
  { id:9300219, name:"Stump", level:4, hp:40, mp:30, wAtk:30, mAtk:0, wDef:0, mDef:10, acc:30, avoid:0, exp:8, weak:"Fire", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300065, name:"Green Cornian1 in Cave", level:100, hp:56000, mp:200, wAtk:480, mAtk:0, wDef:800, mDef:500, acc:205, avoid:45, exp:1000, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9300072, name:"Blue Wyvern 2 in Cave", level:101, hp:57000, mp:250, wAtk:495, mAtk:535, wDef:850, mDef:570, acc:205, avoid:38, exp:1000, weak:"Fire", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9300301, name:"Purple Ribbon Pig of the Maze", level:10, hp:10, mp:10, wAtk:20, mAtk:0, wDef:10, mDef:10, acc:10, avoid:0, exp:1, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9420001, name:"Frog", level:8, hp:75, mp:45, wAtk:52, mAtk:0, wDef:5, mDef:10, acc:42, avoid:1, exp:17, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9500334, name:"Lord Pirate", level:55, hp:48000, mp:150, wAtk:165, mAtk:160, wDef:180, mDef:200, acc:135, avoid:18, exp:925, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9300007, name:"Bloctopus from Another Dimension", level:35, hp:4900, mp:0, wAtk:115, mAtk:125, wDef:120, mDef:150, acc:100, avoid:15, exp:288, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9300279, name:"Purple Snail of the Maze", level:10, hp:10, mp:10, wAtk:20, mAtk:0, wDef:10, mDef:10, acc:10, avoid:0, exp:1, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:6090003, name:"Scholar Ghost", level:62, hp:6000, mp:100, wAtk:185, mAtk:200, wDef:170, mDef:130, acc:80, avoid:999, exp:3984, weak:"-", strong:"-", immune:"-", boss:true, location:"1 map", undead:true, auto:true },
  { id:9300069, name:"Red Wyvern 1 in Cave", level:97, hp:53000, mp:210, wAtk:450, mAtk:500, wDef:830, mDef:550, acc:203, avoid:37, exp:800, weak:"Ice", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9300085, name:"Jr. Balrog in Another World", level:80, hp:50000, mp:500, wAtk:450, mAtk:605, wDef:420, mDef:450, acc:150, avoid:30, exp:2000, weak:"Holy", strong:"-", immune:"Poison", boss:true, location:"1 map", undead:false, auto:true },
  { id:9500340, name:"King Slime", level:40, hp:8000, mp:100, wAtk:130, mAtk:165, wDef:160, mDef:160, acc:140, avoid:10, exp:800, weak:"-", strong:"-", immune:"-", boss:true, location:"30 maps", undead:false, auto:true },
  { id:6130209, name:"Sage Cat", level:66, hp:9000, mp:200, wAtk:220, mAtk:270, wDef:160, mDef:200, acc:120, avoid:24, exp:255, weak:"-", strong:"-", immune:"-", boss:false, location:"3 maps", undead:false, auto:true },
  { id:2220000, name:"Mano ", level:20, hp:2000, mp:30, wAtk:90, mAtk:0, wDef:20, mDef:30, acc:60, avoid:8, exp:120, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9500162, name:"Harp", level:80, hp:27000, mp:300, wAtk:350, mAtk:410, wDef:650, mDef:450, acc:140, avoid:28, exp:850, weak:"Poison", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300356, name:"Sma Gingerman", level:1, hp:30, mp:0, wAtk:0, mAtk:0, wDef:5, mDef:20, acc:40, avoid:2, exp:1, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9400741, name:"Skel Guard Dog", level:140, hp:120000, mp:0, wAtk:420, mAtk:0, wDef:650, mDef:500, acc:180, avoid:30, exp:5000, weak:"Holy", strong:"-", immune:"-", boss:false, location:"1 map", undead:true, auto:true },
  { id:9300025, name:"Gargoyle", level:68, hp:35000, mp:300, wAtk:260, mAtk:360, wDef:340, mDef:570, acc:140, avoid:20, exp:1150, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:4090000, name:"Iron Hook", level:42, hp:2200, mp:60, wAtk:95, mAtk:0, wDef:400, mDef:400, acc:100, avoid:18, exp:99, weak:"-", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:9300171, name:"Bloctopus from Another Dimension", level:35, hp:4900, mp:0, wAtk:115, mAtk:125, wDef:120, mDef:150, acc:100, avoid:15, exp:288, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9400602, name:"Strawberry Cake", level:25, hp:600, mp:60, wAtk:95, mAtk:0, wDef:35, mDef:35, acc:70, avoid:5, exp:58, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9300272, name:"Target Orange Mushroom", level:8, hp:80, mp:45, wAtk:42, mAtk:0, wDef:0, mDef:10, acc:42, avoid:1, exp:15, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9500160, name:"Green King Goblin", level:70, hp:25000, mp:200, wAtk:285, mAtk:335, wDef:280, mDef:280, acc:120, avoid:15, exp:400, weak:"-", strong:"-", immune:"Poison", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9300233, name:"Tick-Tock", level:40, hp:1900, mp:50, wAtk:120, mAtk:0, wDef:160, mDef:170, acc:115, avoid:20, exp:95, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9500144, name:"Coke Snail", level:10, hp:120, mp:20, wAtk:70, mAtk:0, wDef:10, mDef:30, acc:30, avoid:2, exp:19, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9420511, name:"Selkie Jr.", level:60, hp:5500, mp:120, wAtk:200, mAtk:220, wDef:190, mDef:220, acc:150, avoid:22, exp:220, weak:"Fire", strong:"-", immune:"-", boss:false, location:"2 maps", undead:true, auto:true },
  { id:9300231, name:"Master Chronos", level:46, hp:2600, mp:70, wAtk:130, mAtk:160, wDef:170, mDef:200, acc:155, avoid:24, exp:115, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:true, auto:true },
  { id:3220001, name:"Deo", level:38, hp:7700, mp:200, wAtk:130, mAtk:0, wDef:100, mDef:120, acc:130, avoid:18, exp:445, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:8120101, name:"Gatekeeper Nex", level:85, hp:138000, mp:150, wAtk:250, mAtk:350, wDef:250, mDef:250, acc:150, avoid:30, exp:330, weak:"-", strong:"-", immune:"-", boss:true, location:"1 map", undead:false, auto:true },
  { id:9300210, name:"Crimson Balrog", level:100, hp:100000, mp:500, wAtk:500, mAtk:720, wDef:800, mDef:800, acc:180, avoid:40, exp:3500, weak:"Holy", strong:"-", immune:"Poison", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9200002, name:"Dark Stump (PC)", level:10, hp:250, mp:10, wAtk:65, mAtk:0, wDef:20, mDef:10, acc:42, avoid:0, exp:18, weak:"Fire", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:8140000, name:"Lycanthrope", level:80, hp:27000, mp:300, wAtk:350, mAtk:410, wDef:650, mDef:520, acc:140, avoid:28, exp:850, weak:"Fire", strong:"-", immune:"-", boss:false, location:"3 maps", undead:false, auto:true },
  { id:8140512, name:"Royal Guard", level:93, hp:50000, mp:250, wAtk:450, mAtk:500, wDef:830, mDef:530, acc:200, avoid:37, exp:2520, weak:"-", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:9420528, name:"Emo Slime", level:47, hp:2850, mp:50, wAtk:150, mAtk:140, wDef:140, mDef:180, acc:150, avoid:24, exp:135, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:2100106, name:"Ear Plug Plead", level:24, hp:550, mp:0, wAtk:95, mAtk:0, wDef:35, mDef:35, acc:50, avoid:9, exp:45, weak:"-", strong:"-", immune:"-", boss:false, location:"3 maps", undead:false, auto:true },
  { id:8120107, name:"Maverick Type D", level:89, hp:25000, mp:190, wAtk:400, mAtk:450, wDef:750, mDef:480, acc:180, avoid:28, exp:2064, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300263, name:"Blue Kentaurus", level:88, hp:37000, mp:200, wAtk:390, mAtk:430, wDef:800, mDef:495, acc:170, avoid:28, exp:1600, weak:"Fire", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9400508, name:"Mad Turkey", level:27, hp:720, mp:40, wAtk:100, mAtk:0, wDef:35, mDef:70, acc:60, avoid:10, exp:55, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:8150101, name:"Cold Shark", level:102, hp:58500, mp:240, wAtk:500, mAtk:535, wDef:855, mDef:575, acc:205, avoid:38, exp:3100, weak:"-", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:9500316, name:"Snow Yeti", level:90, hp:120000, mp:300, wAtk:450, mAtk:430, wDef:800, mDef:500, acc:195, avoid:38, exp:5200, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9400614, name:"Strange Orange Mushroom", level:8, hp:80, mp:45, wAtk:42, mAtk:0, wDef:0, mDef:10, acc:42, avoid:1, exp:15, weak:"-", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:5100004, name:"Samiho", level:56, hp:4500, mp:120, wAtk:165, mAtk:180, wDef:150, mDef:190, acc:135, avoid:28, exp:185, weak:"Fire", strong:"-", immune:"-", boss:false, location:"4 maps", undead:false, auto:true },
  { id:7120107, name:"Overlord B", level:75, hp:15000, mp:150, wAtk:250, mAtk:350, wDef:250, mDef:250, acc:150, avoid:30, exp:330, weak:"-", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:9300004, name:"Mimic", level:54, hp:4100, mp:50, wAtk:155, mAtk:0, wDef:275, mDef:215, acc:175, avoid:25, exp:165, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300124, name:"Lord Pirate's Kru", level:60, hp:7800, mp:100, wAtk:160, mAtk:240, wDef:190, mDef:250, acc:130, avoid:23, exp:156, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9500118, name:"Tweeter", level:39, hp:1900, mp:0, wAtk:130, mAtk:0, wDef:120, mDef:130, acc:135, avoid:17, exp:85, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300234, name:"Ligator", level:32, hp:1200, mp:40, wAtk:110, mAtk:0, wDef:45, mDef:40, acc:70, avoid:12, exp:60, weak:"Fire", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:6230200, name:"Dark Pepe", level:64, hp:7800, mp:80, wAtk:177, mAtk:0, wDef:220, mDef:240, acc:210, avoid:31, exp:250, weak:"Holy", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:3230103, name:"King Bloctopus", level:38, hp:1850, mp:110, wAtk:120, mAtk:130, wDef:120, mDef:140, acc:140, avoid:18, exp:85, weak:"-", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:9410001, name:"Stylish Stray Dog", level:25, hp:550, mp:30, wAtk:85, mAtk:0, wDef:30, mDef:50, acc:60, avoid:8, exp:43, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300112, name:"Lord Pirate's 100yrOld Bellflower", level:59, hp:4100, mp:160, wAtk:160, mAtk:0, wDef:170, mDef:210, acc:150, avoid:22, exp:100, weak:"-", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:9400576, name:"Windraider", level:70, hp:16000, mp:400, wAtk:300, mAtk:415, wDef:265, mDef:365, acc:190, avoid:30, exp:800, weak:"-", strong:"-", immune:"Poison", boss:false, location:"12 maps", undead:false, auto:true },
  { id:9500152, name:"Coke Mushroom", level:20, hp:350, mp:30, wAtk:90, mAtk:0, wDef:10, mDef:60, acc:55, avoid:7, exp:32, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:3210204, name:"Roloduck", level:34, hp:1200, mp:0, wAtk:110, mAtk:0, wDef:70, mDef:85, acc:100, avoid:16, exp:70, weak:"-", strong:"-", immune:"-", boss:false, location:"4 maps", undead:false, auto:true },
  { id:4230504, name:"Red Flower Serpent", level:45, hp:2550, mp:0, wAtk:135, mAtk:0, wDef:150, mDef:160, acc:200, avoid:20, exp:110, weak:"-", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:9400515, name:"Indigo Eye", level:38, hp:1550, mp:65, wAtk:125, mAtk:0, wDef:50, mDef:70, acc:70, avoid:15, exp:85, weak:"-", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:9300222, name:"Royal Cactus", level:28, hp:750, mp:0, wAtk:105, mAtk:0, wDef:40, mDef:40, acc:60, avoid:10, exp:55, weak:"Fire", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300014, name:"Dark Eye from Another Dimension", level:43, hp:6500, mp:0, wAtk:130, mAtk:0, wDef:70, mDef:470, acc:120, avoid:18, exp:340, weak:"-", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:9200001, name:"Fire Boar (PC)", level:32, hp:1000, mp:60, wAtk:110, mAtk:0, wDef:40, mDef:40, acc:60, avoid:10, exp:60, weak:"Ice", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:1140100, name:"Ghost Stump", level:19, hp:330, mp:35, wAtk:90, mAtk:0, wDef:40, mDef:15, acc:55, avoid:10, exp:33, weak:"-", strong:"-", immune:"-", boss:false, location:"5 maps", undead:false, auto:true },
  { id:3000006, name:"Krip", level:30, hp:900, mp:50, wAtk:100, mAtk:0, wDef:40, mDef:40, acc:65, avoid:12, exp:55, weak:"Poison", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:8200011, name:"Oblivion Guardian", level:128, hp:133000, mp:340, wAtk:635, mAtk:715, wDef:1030, mDef:630, acc:220, avoid:45, exp:6670, weak:"Poison", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:9300118, name:"Lord Pirate's Devoted Captain", level:64, hp:28200, mp:100, wAtk:170, mAtk:270, wDef:250, mDef:260, acc:165, avoid:26, exp:378, weak:"-", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:9400568, name:"Turkey Commando", level:20, hp:350, mp:150, wAtk:90, mAtk:90, wDef:10, mDef:20, acc:55, avoid:8, exp:41, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9420015, name:"NooNoo", level:15, hp:500000, mp:100, wAtk:20, mAtk:20, wDef:300, mDef:300, acc:1000, avoid:25, exp:1500, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:6130202, name:"Morphed Blin", level:60, hp:7000, mp:170, wAtk:195, mAtk:200, wDef:220, mDef:230, acc:200, avoid:25, exp:330, weak:"Holy", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300247, name:"Stone Bug", level:65, hp:6700, mp:100, wAtk:160, mAtk:190, wDef:170, mDef:245, acc:135, avoid:0, exp:255, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:7130003, name:"Dual Beetle", level:76, hp:18000, mp:200, wAtk:300, mAtk:350, wDef:400, mDef:400, acc:140, avoid:27, exp:370, weak:"-", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:9300077, name:"T-Skelegon in Cave", level:113, hp:85000, mp:250, wAtk:530, mAtk:670, wDef:810, mDef:710, acc:210, avoid:38, exp:1500, weak:"Holy", strong:"-", immune:"-", boss:false, location:"1 map", undead:true, auto:true },
  { id:9300128, name:"Bloctopus ", level:30, hp:1800, mp:0, wAtk:145, mAtk:165, wDef:100, mDef:150, acc:70, avoid:18, exp:113, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300274, name:"Cynical Orange Mushroom", level:8, hp:80, mp:45, wAtk:42, mAtk:0, wDef:0, mDef:10, acc:42, avoid:0, exp:15, weak:"-", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:9300006, name:"Black Ratz from Another Dimension", level:34, hp:4300, mp:0, wAtk:125, mAtk:0, wDef:95, mDef:95, acc:90, avoid:14, exp:280, weak:"-", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:7220002, name:"King Sage Cat", level:77, hp:108000, mp:520, wAtk:320, mAtk:350, wDef:520, mDef:410, acc:160, avoid:27, exp:2280, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9420540, name:"Gallopera", level:94, hp:43000, mp:150, wAtk:430, mAtk:460, wDef:820, mDef:540, acc:198, avoid:37, exp:2500, weak:"Holy", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9400563, name:"Nightmare", level:40, hp:1930, mp:2000, wAtk:125, mAtk:120, wDef:130, mDef:140, acc:165, avoid:18, exp:120, weak:"-", strong:"-", immune:"-", boss:false, location:"9 maps", undead:false, auto:true },
  { id:9300039, name:"Papa Pixie", level:65, hp:672000, mp:60000, wAtk:270, mAtk:290, wDef:450, mDef:520, acc:190, avoid:18, exp:17000, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9400545, name:"Wolf Spider", level:80, hp:28000, mp:350, wAtk:450, mAtk:490, wDef:700, mDef:650, acc:175, avoid:30, exp:1200, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9400582, name:"Crimson Guardian", level:120, hp:120000, mp:2000, wAtk:650, mAtk:800, wDef:1000, mDef:800, acc:230, avoid:40, exp:6100, weak:"-", strong:"-", immune:"Holy", boss:false, location:"3 maps", undead:false, auto:true },
  { id:9410000, name:"Stray Dog", level:23, hp:500, mp:30, wAtk:80, mAtk:0, wDef:28, mDef:45, acc:60, avoid:7, exp:40, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:4300013, name:"Spirit of Rock", level:49, hp:250000, mp:50000, wAtk:200, mAtk:230, wDef:250, mDef:280, acc:160, avoid:22, exp:1700, weak:"-", strong:"-", immune:"-", boss:true, location:"2 maps", undead:false, auto:true },
  { id:9300326, name:"Unknown Jr. Balrog", level:50, hp:10000, mp:300, wAtk:160, mAtk:220, wDef:110, mDef:150, acc:80, avoid:20, exp:400, weak:"Holy", strong:"-", immune:"Poison", boss:true, location:"1 map", undead:false, auto:true },
  { id:9300308, name:"Sky Mushroom of the Maze VI", level:10, hp:160, mp:10, wAtk:20, mAtk:0, wDef:10, mDef:10, acc:10, avoid:0, exp:1, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9400652, name:"Possessed Bear Doll", level:65, hp:10000, mp:100, wAtk:200, mAtk:0, wDef:190, mDef:250, acc:170, avoid:27, exp:300, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:8120100, name:"Gatekeeper Nex", level:81, hp:126000, mp:150, wAtk:250, mAtk:350, wDef:250, mDef:250, acc:150, avoid:30, exp:330, weak:"-", strong:"-", immune:"-", boss:true, location:"1 map", undead:false, auto:true },
  { id:4300011, name:"Cheap Amplifier", level:48, hp:2800, mp:250, wAtk:160, mAtk:170, wDef:180, mDef:195, acc:140, avoid:22, exp:138, weak:"-", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:9300113, name:"Lord Pirate's 100yrOld Ancient Bellflower", level:60, hp:4300, mp:160, wAtk:170, mAtk:0, wDef:180, mDef:215, acc:150, avoid:24, exp:104, weak:"-", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:9500171, name:"Crimson Balrog", level:50, hp:18620, mp:500, wAtk:135, mAtk:145, wDef:120, mDef:120, acc:180, avoid:0, exp:1267, weak:"Holy", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9300130, name:"Chronos ", level:30, hp:2300, mp:30, wAtk:155, mAtk:0, wDef:110, mDef:210, acc:135, avoid:20, exp:113, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:true, auto:true },
  { id:3210205, name:"Black Ratz", level:34, hp:1150, mp:0, wAtk:115, mAtk:0, wDef:75, mDef:75, acc:105, avoid:14, exp:70, weak:"-", strong:"-", immune:"-", boss:false, location:"10 maps", undead:false, auto:true },
  { id:9420537, name:"Yabber Doo", level:75, hp:15800, mp:130, wAtk:270, mAtk:320, wDef:250, mDef:250, acc:120, avoid:25, exp:352, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9500198, name:"Gift Box", level:100, hp:5, mp:0, wAtk:10, mAtk:10, wDef:10, mDef:10, acc:80, avoid:1, exp:10, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:6300003, name:"Punco", level:67, hp:40000, mp:700, wAtk:310, mAtk:435, wDef:270, mDef:410, acc:165, avoid:37, exp:210, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:1140130, name:"Smirking Ghost Stump", level:19, hp:330, mp:35, wAtk:90, mAtk:0, wDef:40, mDef:15, acc:55, avoid:10, exp:33, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9400643, name:"Olivia", level:70, hp:810000, mp:200, wAtk:280, mAtk:300, wDef:335, mDef:365, acc:180, avoid:33, exp:11200, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:4230300, name:"Moon Bunny", level:45, hp:2600, mp:170, wAtk:150, mAtk:155, wDef:100, mDef:180, acc:190, avoid:20, exp:110, weak:"Fire", strong:"-", immune:"-", boss:false, location:"3 maps", undead:false, auto:true },
  { id:9400597, name:"Azure Ocelot", level:120, hp:5000000, mp:5000000, wAtk:600, mAtk:500, wDef:800, mDef:900, acc:200, avoid:45, exp:250000, weak:"Holy", strong:"-", immune:"Ice", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9001000, name:"Dances with Balrog's Clone", level:80, hp:150000, mp:345, wAtk:330, mAtk:0, wDef:530, mDef:115, acc:150, avoid:15, exp:2400, weak:"-", strong:"-", immune:"-", boss:true, location:"1 map", undead:false, auto:true },
  { id:9500328, name:"Crimson Balrog", level:35, hp:13000, mp:200, wAtk:120, mAtk:130, wDef:100, mDef:100, acc:145, avoid:12, exp:360, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:7130501, name:"Dark Rash", level:74, hp:15500, mp:150, wAtk:295, mAtk:0, wDef:285, mDef:295, acc:160, avoid:27, exp:340, weak:"-", strong:"-", immune:"-", boss:false, location:"3 maps", undead:false, auto:true },
  { id:9400536, name:"Geist Balrog Phase 1", level:80, hp:100000, mp:500, wAtk:200, mAtk:305, wDef:420, mDef:450, acc:150, avoid:30, exp:1000, weak:"Holy", strong:"-", immune:"Poison", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9300186, name:"Deo", level:38, hp:7700, mp:200, wAtk:130, mAtk:0, wDef:100, mDef:120, acc:130, avoid:18, exp:445, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:6230602, name:"Officer Skeleton", level:63, hp:7500, mp:100, wAtk:170, mAtk:200, wDef:190, mDef:230, acc:150, avoid:25, exp:240, weak:"Holy", strong:"-", immune:"-", boss:false, location:"5 maps", undead:true, auto:true },
  { id:8150302, name:"Dark Wyvern", level:103, hp:60000, mp:250, wAtk:505, mAtk:540, wDef:900, mDef:580, acc:205, avoid:38, exp:3150, weak:"-", strong:"-", immune:"-", boss:false, location:"5 maps", undead:false, auto:true },
  { id:100134, name:"Murukun", level:9, hp:95, mp:0, wAtk:48, mAtk:0, wDef:10, mDef:15, acc:42, avoid:1, exp:18, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9400509, name:"Sakura Cellion", level:33, hp:1100, mp:70, wAtk:105, mAtk:0, wDef:60, mDef:80, acc:95, avoid:15, exp:65, weak:"Ice", strong:"-", immune:"-", boss:false, location:"4 maps", undead:false, auto:true },
  { id:9300259, name:"Blue Mushroom", level:20, hp:350, mp:30, wAtk:90, mAtk:0, wDef:10, mDef:60, acc:55, avoid:7, exp:32, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:4110300, name:"Iron Mutae", level:42, hp:2400, mp:0, wAtk:135, mAtk:0, wDef:110, mDef:90, acc:95, avoid:12, exp:102, weak:"-", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:9300107, name:"Peeking Lord Pirate", level:70, hp:300000, mp:300, wAtk:250, mAtk:310, wDef:670, mDef:455, acc:140, avoid:22, exp:4000, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9300179, name:"Spright", level:65, hp:7500, mp:100, wAtk:160, mAtk:190, wDef:170, mDef:255, acc:135, avoid:0, exp:255, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9420501, name:"Freezer", level:38, hp:1900, mp:10, wAtk:125, mAtk:0, wDef:100, mDef:200, acc:85, avoid:18, exp:80, weak:"Fire", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9300156, name:"Black Magician's Disciple", level:10, hp:300, mp:40, wAtk:35, mAtk:0, wDef:5, mDef:15, acc:40, avoid:0, exp:15, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300193, name:"Timer", level:59, hp:21000, mp:200, wAtk:200, mAtk:205, wDef:180, mDef:230, acc:150, avoid:20, exp:650, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:3400002, name:"Melon Bubble Tea", level:37, hp:1600, mp:100, wAtk:115, mAtk:120, wDef:110, mDef:100, acc:100, avoid:17, exp:88, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:7130400, name:"Yellow King Goblin", level:70, hp:25000, mp:200, wAtk:285, mAtk:335, wDef:280, mDef:280, acc:120, avoid:15, exp:400, weak:"Ice", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9500322, name:"Kid Snowman", level:10, hp:3, mp:20, wAtk:10, mAtk:10, wDef:10, mDef:10, acc:-25, avoid:1, exp:20, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9400114, name:"Slot Machine", level:50, hp:50000, mp:300, wAtk:120, mAtk:100, wDef:50, mDef:10, acc:350, avoid:5, exp:1500, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300023, name:"Myst Knight", level:66, hp:40000, mp:200, wAtk:250, mAtk:320, wDef:550, mDef:320, acc:145, avoid:25, exp:1060, weak:"Holy", strong:"-", immune:"-", boss:false, location:"1 map", undead:true, auto:true },
  { id:3230104, name:"Mask Fish", level:32, hp:1000, mp:0, wAtk:100, mAtk:0, wDef:70, mDef:80, acc:70, avoid:14, exp:65, weak:"-", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:9500100, name:"Slime", level:6, hp:50, mp:35, wAtk:42, mAtk:0, wDef:5, mDef:10, acc:35, avoid:1, exp:10, weak:"Lightning", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300337, name:"Mecateon", level:46, hp:2600, mp:170, wAtk:135, mAtk:158, wDef:160, mDef:210, acc:180, avoid:20, exp:110, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:5220002, name:"Faust", level:50, hp:9800, mp:100, wAtk:165, mAtk:0, wDef:110, mDef:150, acc:100, avoid:20, exp:410, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9400512, name:"Cake Mob (2nd) ", level:30, hp:950, mp:50, wAtk:100, mAtk:0, wDef:40, mDef:40, acc:70, avoid:13, exp:65, weak:"Poison", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:8200003, name:"Memory Guardian", level:98, hp:53000, mp:200, wAtk:460, mAtk:525, wDef:870, mDef:530, acc:200, avoid:37, exp:2600, weak:"-", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:3400000, name:"Cherry Bubble Tea", level:35, hp:1400, mp:100, wAtk:110, mAtk:115, wDef:100, mDef:115, acc:90, avoid:16, exp:80, weak:"-", strong:"-", immune:"-", boss:false, location:"3 maps", undead:false, auto:true },
  { id:9500125, name:"Red Drake", level:60, hp:6000, mp:120, wAtk:200, mAtk:220, wDef:190, mDef:220, acc:150, avoid:22, exp:220, weak:"Ice", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:8180000, name:"Manon", level:105, hp:3700000, mp:1500, wAtk:550, mAtk:680, wDef:900, mDef:850, acc:200, avoid:39, exp:13500, weak:"Ice", strong:"-", immune:"-", boss:true, location:"2 maps", undead:false, auto:true },
  { id:9300250, name:"Taurospear", level:75, hp:18000, mp:220, wAtk:300, mAtk:390, wDef:550, mDef:400, acc:130, avoid:30, exp:350, weak:"-", strong:"-", immune:"Poison", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:4230123, name:"Sparker", level:43, hp:2400, mp:150, wAtk:130, mAtk:155, wDef:140, mDef:172, acc:160, avoid:15, exp:103, weak:"-", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:7160000, name:"Dual Ghost Pirate", level:87, hp:35000, mp:200, wAtk:385, mAtk:425, wDef:775, mDef:470, acc:160, avoid:28, exp:1500, weak:"Fire", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:3210206, name:"Helly", level:36, hp:1350, mp:0, wAtk:115, mAtk:0, wDef:85, mDef:105, acc:130, avoid:17, exp:77, weak:"-", strong:"-", immune:"-", boss:false, location:"6 maps", undead:false, auto:true },
  { id:9500120, name:"King Block Golem", level:45, hp:2600, mp:0, wAtk:150, mAtk:0, wDef:130, mDef:110, acc:105, avoid:14, exp:110, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300005, name:"Ratz from Another Dimension", level:32, hp:3700, mp:0, wAtk:112, mAtk:0, wDef:85, mDef:95, acc:80, avoid:13, exp:260, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9400618, name:"Strange Dark Axe Stump", level:22, hp:550, mp:40, wAtk:85, mAtk:0, wDef:50, mDef:20, acc:45, avoid:7, exp:38, weak:"Fire", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:8140001, name:"Harp", level:80, hp:27000, mp:300, wAtk:350, mAtk:410, wDef:650, mDef:450, acc:140, avoid:28, exp:850, weak:"Poison", strong:"-", immune:"-", boss:false, location:"3 maps", undead:false, auto:true },
  { id:9300033, name:"Jr. Gargoyle", level:62, hp:15000, mp:100, wAtk:220, mAtk:0, wDef:250, mDef:250, acc:130, avoid:26, exp:430, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300080, name:"Kru", level:68, hp:13000, mp:100, wAtk:210, mAtk:290, wDef:190, mDef:270, acc:130, avoid:26, exp:265, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9302011, name:"Lupin Pig", level:32, hp:1050, mp:0, wAtk:105, mAtk:0, wDef:50, mDef:70, acc:80, avoid:14, exp:65, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9400570, name:"Anniversary Cake", level:15, hp:250, mp:25, wAtk:82, mAtk:0, wDef:12, mDef:40, acc:45, avoid:5, exp:30, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300227, name:"Lorang", level:37, hp:1950, mp:10, wAtk:125, mAtk:0, wDef:100, mDef:200, acc:85, avoid:18, exp:80, weak:"Lightning", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9400111, name:"Leader B", level:64, hp:9000, mp:350, wAtk:160, mAtk:200, wDef:190, mDef:200, acc:150, avoid:24, exp:320, weak:"Poison", strong:"-", immune:"-", boss:false, location:"5 maps", undead:false, auto:true },
  { id:9300218, name:"Red Snail", level:4, hp:40, mp:30, wAtk:27, mAtk:0, wDef:3, mDef:10, acc:35, avoid:0, exp:8, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300225, name:"Lupin", level:37, hp:1500, mp:100, wAtk:110, mAtk:125, wDef:35, mDef:40, acc:100, avoid:20, exp:77, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:6400002, name:"Separated Dark Yeti", level:68, hp:13000, mp:100, wAtk:210, mAtk:290, wDef:190, mDef:270, acc:130, avoid:26, exp:715, weak:"Holy", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9420002, name:"Python", level:60, hp:6000, mp:200, wAtk:200, mAtk:190, wDef:160, mDef:220, acc:150, avoid:22, exp:230, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300038, name:"Ghost Pixie", level:59, hp:9000, mp:100, wAtk:200, mAtk:190, wDef:160, mDef:200, acc:130, avoid:25, exp:420, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:true, auto:true },
  { id:9300293, name:"Advanced Leviathan", level:100, hp:560000, mp:500, wAtk:500, mAtk:550, wDef:800, mDef:800, acc:180, avoid:40, exp:3500, weak:"-", strong:"-", immune:"-", boss:true, location:"1 map", undead:false, auto:true },
  { id:9500131, name:"Lucida", level:73, hp:15500, mp:240, wAtk:280, mAtk:315, wDef:300, mDef:320, acc:160, avoid:28, exp:320, weak:"Holy", strong:"-", immune:"Poison", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9200018, name:"Jr. Yetti", level:50, hp:3700, mp:20, wAtk:150, mAtk:0, wDef:170, mDef:180, acc:120, avoid:25, exp:135, weak:"Fire", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300371, name:"Witch Bear", level:50, hp:9800, mp:100, wAtk:120, mAtk:0, wDef:110, mDef:150, acc:100, avoid:20, exp:410, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:5110301, name:"Roid ", level:54, hp:4400, mp:160, wAtk:155, mAtk:0, wDef:180, mDef:215, acc:150, avoid:18, exp:168, weak:"-", strong:"-", immune:"-", boss:false, location:"3 maps", undead:false, auto:true },
  { id:9500370, name:"Mecateon", level:15, hp:450, mp:170, wAtk:135, mAtk:158, wDef:160, mDef:210, acc:180, avoid:1, exp:20, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300117, name:"Lord Pirate's Devoted Kru", level:62, hp:22800, mp:100, wAtk:155, mAtk:240, wDef:190, mDef:250, acc:130, avoid:24, exp:313, weak:"-", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:7110301, name:"Homunculus", level:73, hp:15500, mp:240, wAtk:280, mAtk:315, wDef:300, mDef:320, acc:160, avoid:28, exp:320, weak:"-", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:4300007, name:"Female Mannequin", level:44, hp:2400, mp:250, wAtk:145, mAtk:155, wDef:165, mDef:180, acc:125, avoid:21, exp:125, weak:"-", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:8140110, name:"Birk", level:85, hp:32000, mp:150, wAtk:380, mAtk:0, wDef:760, mDef:465, acc:160, avoid:27, exp:1420, weak:"Ice", strong:"-", immune:"-", boss:false, location:"3 maps", undead:false, auto:true },
  { id:9300283, name:"Transforming Yellow Snail of the Maze", level:10, hp:10, mp:10, wAtk:20, mAtk:0, wDef:10, mDef:10, acc:10, avoid:0, exp:1, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300036, name:"Black Knight", level:66, hp:22000, mp:200, wAtk:250, mAtk:320, wDef:550, mDef:320, acc:145, avoid:25, exp:100, weak:"Holy", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:true, auto:true },
  { id:9500108, name:"Ligator", level:32, hp:1200, mp:40, wAtk:110, mAtk:0, wDef:45, mDef:40, acc:70, avoid:12, exp:60, weak:"Fire", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300249, name:"Tauromacis", level:70, hp:15000, mp:200, wAtk:270, mAtk:320, wDef:250, mDef:250, acc:120, avoid:15, exp:270, weak:"-", strong:"-", immune:"Poison", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300154, name:"Experimental Neo Huroid", level:58, hp:5600, mp:200, wAtk:170, mAtk:205, wDef:180, mDef:210, acc:155, avoid:20, exp:205, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:3110301, name:"Dark Sand Dwarf ", level:32, hp:1000, mp:40, wAtk:90, mAtk:0, wDef:40, mDef:40, acc:70, avoid:12, exp:62, weak:"Ice", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:9500114, name:"King Blockpus", level:38, hp:1850, mp:110, wAtk:120, mAtk:130, wDef:120, mDef:140, acc:140, avoid:18, exp:85, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9400577, name:"Firebrand", level:90, hp:21000, mp:5000, wAtk:420, mAtk:490, wDef:820, mDef:600, acc:195, avoid:37, exp:910, weak:"-", strong:"-", immune:"-", boss:false, location:"7 maps", undead:false, auto:true },
  { id:4230120, name:"Plateon", level:44, hp:2480, mp:0, wAtk:140, mAtk:0, wDef:140, mDef:190, acc:170, avoid:18, exp:105, weak:"-", strong:"-", immune:"-", boss:false, location:"8 maps", undead:false, auto:true },
  { id:9300081, name:"Flyeye", level:8, hp:80, mp:30, wAtk:25, mAtk:0, wDef:5, mDef:30, acc:40, avoid:1, exp:10, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9400561, name:"Voodoo", level:60, hp:6800, mp:200, wAtk:190, mAtk:200, wDef:240, mDef:210, acc:210, avoid:22, exp:335, weak:"-", strong:"-", immune:"-", boss:false, location:"5 maps", undead:true, auto:true },
  { id:9300282, name:"Blue Transforming Snail of the Maze", level:10, hp:10, mp:10, wAtk:20, mAtk:0, wDef:10, mDef:10, acc:10, avoid:0, exp:1, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:7220000, name:"Tae Roon", level:71, hp:93000, mp:200, wAtk:285, mAtk:310, wDef:335, mDef:265, acc:175, avoid:30, exp:1580, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:8220015, name:"Nibelung", level:95, hp:240000, mp:600, wAtk:565, mAtk:560, wDef:850, mDef:820, acc:200, avoid:37, exp:6340, weak:"Lightning", strong:"-", immune:"Poison", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9400633, name:"Astaroth", level:32, hp:180000, mp:500, wAtk:180, mAtk:180, wDef:150, mDef:150, acc:120, avoid:15, exp:5250, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9500300, name:"Busted Doll", level:100, hp:10, mp:10, wAtk:40, mAtk:40, wDef:10, mDef:10, acc:40, avoid:1, exp:12, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300316, name:"Soul Teddy", level:53, hp:4500, mp:90, wAtk:140, mAtk:160, wDef:140, mDef:140, acc:95, avoid:19, exp:2, weak:"Holy", strong:"-", immune:"-", boss:true, location:"2 maps", undead:false, auto:true },
  { id:9400581, name:"Stormbreaker", level:80, hp:38000, mp:5000, wAtk:410, mAtk:460, wDef:700, mDef:480, acc:160, avoid:30, exp:1650, weak:"-", strong:"-", immune:"Lightning", boss:false, location:"10 maps", undead:false, auto:true },
  { id:9600001, name:"Rooster", level:20, hp:340, mp:30, wAtk:85, mAtk:0, wDef:10, mDef:20, acc:55, avoid:7, exp:33, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300198, name:"Lord Pirate", level:60, hp:420000, mp:300, wAtk:250, mAtk:310, wDef:670, mDef:455, acc:140, avoid:22, exp:7200, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:8160000, name:"Gatekeeper", level:108, hp:78000, mp:200, wAtk:550, mAtk:600, wDef:900, mDef:650, acc:210, avoid:37, exp:4300, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:8141100, name:"Gigantic Spirit Viking", level:98, hp:58000, mp:220, wAtk:460, mAtk:520, wDef:845, mDef:580, acc:205, avoid:38, exp:2600, weak:"Lightning", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:4250001, name:"Tree Rod", level:46, hp:2600, mp:0, wAtk:130, mAtk:0, wDef:300, mDef:300, acc:130, avoid:15, exp:112, weak:"-", strong:"-", immune:"-", boss:false, location:"3 maps", undead:false, auto:true },
  { id:9500128, name:"Dark Yeti", level:68, hp:13000, mp:100, wAtk:210, mAtk:290, wDef:190, mDef:270, acc:130, avoid:26, exp:265, weak:"Holy", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300090, name:"Freezer", level:120, hp:1350000, mp:1500, wAtk:430, mAtk:480, wDef:780, mDef:850, acc:200, avoid:39, exp:13500, weak:"Fire", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9400653, name:"Possessed Rabbit Doll", level:65, hp:13000, mp:100, wAtk:200, mAtk:0, wDef:205, mDef:250, acc:150, avoid:31, exp:310, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:2230105, name:"Seacle", level:23, hp:500, mp:0, wAtk:85, mAtk:0, wDef:35, mDef:45, acc:55, avoid:9, exp:42, weak:"Poison", strong:"-", immune:"-", boss:false, location:"3 maps", undead:false, auto:true },
  { id:9500134, name:"Lycanthrope", level:80, hp:27000, mp:300, wAtk:350, mAtk:410, wDef:650, mDef:520, acc:140, avoid:28, exp:850, weak:"Fire", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300096, name:"Black Kentaurus", level:88, hp:37000, mp:200, wAtk:390, mAtk:430, wDef:800, mDef:495, acc:170, avoid:28, exp:1600, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:3400001, name:"Mango Bubble Tea", level:36, hp:1500, mp:100, wAtk:112, mAtk:118, wDef:105, mDef:118, acc:95, avoid:16, exp:85, weak:"-", strong:"-", immune:"-", boss:false, location:"3 maps", undead:false, auto:true },
  { id:1110130, name:"Dejected Green Mushroom", level:15, hp:250, mp:25, wAtk:82, mAtk:0, wDef:12, mDef:40, acc:45, avoid:5, exp:26, weak:"-", strong:"-", immune:"Poison", boss:false, location:"1 map", undead:false, auto:true },
  { id:9300040, name:"Cellion in Tower of Goddess", level:54, hp:4400, mp:200, wAtk:150, mAtk:165, wDef:180, mDef:130, acc:120, avoid:20, exp:170, weak:"Ice", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9300340, name:"Maple Bday Cake", level:15, hp:100, mp:100, wAtk:1, mAtk:1, wDef:10, mDef:10, acc:10, avoid:0, exp:6, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:100120, name:"Tino", level:1, hp:9, mp:0, wAtk:17, mAtk:0, wDef:0, mDef:0, acc:20, avoid:0, exp:4, weak:"-", strong:"-", immune:"-", boss:false, location:"3 maps", undead:false, auto:true },
  { id:9400634, name:"Frog", level:5, hp:500, mp:10, wAtk:10, mAtk:10, wDef:10, mDef:10, acc:10, avoid:10, exp:10, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9500145, name:"Coke Seal", level:38, hp:1850, mp:0, wAtk:125, mAtk:0, wDef:100, mDef:125, acc:130, avoid:18, exp:87, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:8120103, name:"Prototype Lord", level:84, hp:31000, mp:170, wAtk:370, mAtk:415, wDef:700, mDef:460, acc:155, avoid:25, exp:1440, weak:"-", strong:"-", immune:"Poison", boss:false, location:"2 maps", undead:false, auto:true },
  { id:9400574, name:"Typhon", level:100, hp:56000, mp:230, wAtk:270, mAtk:400, wDef:500, mDef:450, acc:180, avoid:40, exp:3200, weak:"-", strong:"-", immune:"Ice", boss:false, location:"1 map", undead:false, auto:true },
  { id:9300121, name:"Lord Pirate's Furious Kru", level:60, hp:9360, mp:100, wAtk:170, mAtk:240, wDef:380, mDef:250, acc:130, avoid:24, exp:187, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9420512, name:"Mr. Anchor", level:68, hp:11500, mp:100, wAtk:220, mAtk:220, wDef:220, mDef:250, acc:140, avoid:27, exp:275, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:true, auto:true },
  { id:6130204, name:"Mr. Alli", level:64, hp:7800, mp:100, wAtk:180, mAtk:230, wDef:190, mDef:230, acc:140, avoid:25, exp:250, weak:"-", strong:"-", immune:"-", boss:false, location:"3 maps", undead:false, auto:true },
  { id:9300075, name:"Skelegon 1 in Cave", level:110, hp:80000, mp:240, wAtk:520, mAtk:660, wDef:800, mDef:700, acc:210, avoid:38, exp:1500, weak:"Holy", strong:"-", immune:"-", boss:false, location:"1 map", undead:true, auto:true },
  { id:9300087, name:"The Charging Taurospear", level:75, hp:18000, mp:220, wAtk:300, mAtk:390, wDef:550, mDef:400, acc:130, avoid:30, exp:350, weak:"-", strong:"-", immune:"Poison", boss:false, location:"1 map", undead:false, auto:true },
  { id:9300177, name:"Poison Golem Level 2", level:62, hp:3500, mp:100, wAtk:150, mAtk:180, wDef:160, mDef:130, acc:135, avoid:0, exp:240, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9420504, name:"Tippo Red", level:50, hp:2900, mp:80, wAtk:155, mAtk:0, wDef:180, mDef:180, acc:130, avoid:20, exp:130, weak:"Ice", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:8140703, name:"Brexton", level:97, hp:55000, mp:200, wAtk:470, mAtk:520, wDef:850, mDef:570, acc:200, avoid:37, exp:2500, weak:"Ice", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9409000, name:"Tutorial Leatty", level:1, hp:8, mp:15, wAtk:20, mAtk:0, wDef:0, mDef:0, acc:30, avoid:0, exp:1, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9400514, name:"Geist Balrog Phase 3", level:95, hp:1500000, mp:5600, wAtk:300, mAtk:430, wDef:600, mDef:500, acc:175, avoid:35, exp:5600, weak:"-", strong:"-", immune:"Poison", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9300086, name:"The Elemental Thanatos", level:108, hp:70000, mp:300, wAtk:510, mAtk:620, wDef:850, mDef:680, acc:210, avoid:38, exp:4100, weak:"Fire", strong:"-", immune:"Ice", boss:true, location:"1 map", undead:true, auto:true },
  { id:5090000, name:"Shade", level:56, hp:30000, mp:200, wAtk:165, mAtk:180, wDef:150, mDef:180, acc:130, avoid:42, exp:5600, weak:"-", strong:"-", immune:"-", boss:true, location:"2 maps", undead:true, auto:true },
  { id:9300331, name:"Gaga", level:10, hp:10, mp:10, wAtk:10, mAtk:10, wDef:10, mDef:10, acc:10, avoid:10, exp:10, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9300024, name:"Puppet Golem", level:67, hp:35000, mp:120, wAtk:310, mAtk:0, wDef:370, mDef:800, acc:145, avoid:21, exp:1100, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9500332, name:"Pianus", level:45, hp:26000, mp:200, wAtk:150, mAtk:170, wDef:130, mDef:110, acc:105, avoid:14, exp:550, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9300376, name:"Witch Bear", level:90, hp:96000, mp:350, wAtk:430, mAtk:430, wDef:700, mDef:465, acc:160, avoid:27, exp:3000, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9300018, name:"Tutorial Jr. Sentinel", level:1, hp:8, mp:15, wAtk:20, mAtk:0, wDef:0, mDef:0, acc:30, avoid:0, exp:1, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9400620, name:"Strange Dark Stump", level:10, hp:250, mp:10, wAtk:65, mAtk:0, wDef:20, mDef:10, acc:42, avoid:0, exp:18, weak:"Fire", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9300135, name:"Master Chronos ", level:30, hp:3000, mp:300, wAtk:145, mAtk:165, wDef:160, mDef:200, acc:150, avoid:24, exp:153, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:true, auto:true },
  { id:3110300, name:"Cube Slime", level:32, hp:1000, mp:0, wAtk:90, mAtk:0, wDef:40, mDef:40, acc:70, avoid:12, exp:62, weak:"-", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:9400586, name:"Crimson Tree", level:75, hp:3500, mp:50, wAtk:140, mAtk:0, wDef:150, mDef:200, acc:150, avoid:10, exp:122, weak:"Fire", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:8200008, name:"Chief Qualm Guardian", level:116, hp:99000, mp:270, wAtk:575, mAtk:655, wDef:990, mDef:590, acc:215, avoid:40, exp:4960, weak:"Fire", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:9300269, name:"So Gong", level:20, hp:2000, mp:100, wAtk:90, mAtk:20, wDef:10, mDef:60, acc:55, avoid:7, exp:35, weak:"-", strong:"-", immune:"-", boss:true, location:"1 map", undead:false, auto:true },
  { id:100132, name:"Murupia", level:5, hp:43, mp:0, wAtk:28, mAtk:0, wDef:3, mDef:10, acc:35, avoid:0, exp:9, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9500147, name:"Yeti and Coketump", level:70, hp:20000, mp:150, wAtk:280, mAtk:330, wDef:280, mDef:280, acc:125, avoid:18, exp:272, weak:"Fire", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300123, name:"Lord Pirate's Mr. Alli", level:59, hp:7350, mp:100, wAtk:155, mAtk:180, wDef:190, mDef:230, acc:140, avoid:20, exp:150, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300246, name:"Tree Road", level:62, hp:3500, mp:100, wAtk:150, mAtk:180, wDef:160, mDef:130, acc:135, avoid:0, exp:240, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300026, name:"Jr. Gargoyle", level:62, hp:15000, mp:100, wAtk:220, mAtk:0, wDef:250, mDef:250, acc:130, avoid:26, exp:430, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300302, name:"Pig of the Maze", level:10, hp:10, mp:10, wAtk:20, mAtk:0, wDef:10, mDef:10, acc:10, avoid:0, exp:1, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300223, name:"Slime", level:6, hp:50, mp:35, wAtk:32, mAtk:0, wDef:5, mDef:10, acc:35, avoid:1, exp:10, weak:"Lightning", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9400655, name:"Strange Orange Mushroom", level:8, hp:80, mp:45, wAtk:42, mAtk:0, wDef:0, mDef:10, acc:42, avoid:1, exp:15, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9300314, name:"Witch Cat", level:200, hp:10, mp:10, wAtk:20, mAtk:0, wDef:10, mDef:10, acc:999, avoid:0, exp:1, weak:"-", strong:"-", immune:"-", boss:true, location:"1 map", undead:false, auto:true },
  { id:9300076, name:"Skelegon 2 in Cave", level:110, hp:80000, mp:240, wAtk:520, mAtk:660, wDef:800, mDef:700, acc:210, avoid:38, exp:1500, weak:"Holy", strong:"-", immune:"-", boss:false, location:"2 maps", undead:true, auto:true },
  { id:9500345, name:"Mushmom", level:60, hp:20000, mp:200, wAtk:200, mAtk:300, wDef:320, mDef:320, acc:150, avoid:27, exp:1200, weak:"-", strong:"-", immune:"-", boss:true, location:"30 maps", undead:false, auto:true },
  { id:9400218, name:"Tauromacis (JP)", level:73, hp:16000, mp:210, wAtk:290, mAtk:330, wDef:260, mDef:260, acc:125, avoid:20, exp:270, weak:"-", strong:"-", immune:"Poison", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300342, name:"Target Orange Mushroom", level:8, hp:80, mp:45, wAtk:42, mAtk:0, wDef:0, mDef:10, acc:42, avoid:1, exp:15, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:6090000, name:"Riche", level:74, hp:11000, mp:500, wAtk:180, mAtk:270, wDef:200, mDef:400, acc:150, avoid:999, exp:25000, weak:"-", strong:"-", immune:"-", boss:true, location:"4 maps", undead:true, auto:true },
  { id:9500319, name:"Giant Snowman", level:70, hp:6000, mp:20, wAtk:10, mAtk:10, wDef:10, mDef:10, acc:40, avoid:1, exp:270, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9420507, name:"Trucker", level:48, hp:3000, mp:50, wAtk:180, mAtk:0, wDef:120, mDef:150, acc:150, avoid:20, exp:160, weak:"Lightning", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9500338, name:"Stumpy", level:35, hp:7000, mp:120, wAtk:125, mAtk:0, wDef:50, mDef:70, acc:80, avoid:12, exp:405, weak:"-", strong:"-", immune:"-", boss:true, location:"30 maps", undead:false, auto:true },
  { id:9400604, name:"Deluxe Candle", level:45, hp:2000, mp:10, wAtk:135, mAtk:0, wDef:80, mDef:80, acc:150, avoid:0, exp:120, weak:"Ice", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9500327, name:"Jr. Balrog", level:30, hp:9500, mp:200, wAtk:100, mAtk:120, wDef:38, mDef:40, acc:65, avoid:12, exp:300, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9300182, name:"Super-Charged Poison Golem", level:85, hp:113500, mp:500, wAtk:300, mAtk:250, wDef:280, mDef:220, acc:190, avoid:18, exp:17980, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9600005, name:"Black Goat", level:35, hp:1250, mp:50, wAtk:120, mAtk:0, wDef:60, mDef:50, acc:65, avoid:12, exp:71, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300020, name:"Muscle Stone", level:63, hp:16000, mp:100, wAtk:285, mAtk:0, wDef:350, mDef:560, acc:140, avoid:23, exp:520, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9500106, name:"Horny Mushroom", level:22, hp:300, mp:35, wAtk:90, mAtk:0, wDef:30, mDef:0, acc:55, avoid:7, exp:35, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9400214, name:"Master Chronos (JP)", level:46, hp:2600, mp:70, wAtk:135, mAtk:160, wDef:175, mDef:200, acc:155, avoid:24, exp:115, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:true, auto:true },
  { id:2100105, name:"Bellamoa", level:23, hp:500, mp:0, wAtk:90, mAtk:0, wDef:35, mDef:40, acc:55, avoid:9, exp:42, weak:"-", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:9500199, name:"Toy Clown", level:100, hp:10, mp:10, wAtk:40, mAtk:40, wDef:5, mDef:10, acc:40, avoid:1, exp:12, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300298, name:"Red Ribbon Pig of the Maze", level:10, hp:10, mp:10, wAtk:20, mAtk:0, wDef:10, mDef:10, acc:10, avoid:0, exp:1, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9400651, name:"Possessed Rabbit Doll", level:50, hp:3950, mp:100, wAtk:150, mAtk:0, wDef:170, mDef:200, acc:100, avoid:28, exp:145, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300041, name:"Cellion in Tower of Goddess", level:57, hp:7300, mp:200, wAtk:165, mAtk:175, wDef:350, mDef:170, acc:125, avoid:22, exp:370, weak:"Ice", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9400745, name:"Jr. Balrog Minion", level:160, hp:5000000, mp:5000, wAtk:700, mAtk:550, wDef:880, mDef:220, acc:180, avoid:55, exp:100000, weak:"Holy", strong:"-", immune:"Poison", boss:true, location:"1 map", undead:false, auto:true },
  { id:7130001, name:"Cerebes", level:72, hp:15200, mp:120, wAtk:272, mAtk:315, wDef:320, mDef:265, acc:175, avoid:30, exp:295, weak:"-", strong:"-", immune:"-", boss:false, location:"3 maps", undead:false, auto:true },
  { id:9500196, name:"Ghost", level:15, hp:15, mp:0, wAtk:72, mAtk:0, wDef:12, mDef:40, acc:45, avoid:1, exp:16, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:true, auto:true },
  { id:9200004, name:"Green Mushroom (PC)", level:15, hp:250, mp:25, wAtk:82, mAtk:0, wDef:12, mDef:40, acc:45, avoid:5, exp:26, weak:"-", strong:"-", immune:"Poison", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9400565, name:"Glutton Ghoul", level:21, hp:300, mp:20, wAtk:90, mAtk:0, wDef:20, mDef:20, acc:85, avoid:10, exp:36, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9500123, name:"Mixed Golem", level:59, hp:6000, mp:150, wAtk:200, mAtk:190, wDef:160, mDef:220, acc:100, avoid:20, exp:210, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:3110102, name:"Ratz", level:32, hp:1000, mp:0, wAtk:102, mAtk:0, wDef:65, mDef:75, acc:90, avoid:13, exp:65, weak:"-", strong:"-", immune:"-", boss:false, location:"6 maps", undead:false, auto:true },
  { id:4110302, name:"Mithril  mutae", level:47, hp:2750, mp:0, wAtk:140, mAtk:0, wDef:155, mDef:160, acc:130, avoid:18, exp:117, weak:"-", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:9300190, name:"King Clang", level:55, hp:25000, mp:200, wAtk:165, mAtk:175, wDef:120, mDef:120, acc:100, avoid:20, exp:1210, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9400549, name:"Headless Horseman", level:101, hp:3500000, mp:5000, wAtk:600, mAtk:650, wDef:800, mDef:800, acc:190, avoid:42, exp:300000, weak:"Lightning", strong:"-", immune:"-", boss:true, location:"8 maps", undead:false, auto:true },
  { id:9600010, name:"Giant Centipede", level:50, hp:18000, mp:200, wAtk:320, mAtk:340, wDef:300, mDef:150, acc:150, avoid:27, exp:1080, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9300284, name:"Transforming Yellow Snail of the Maze", level:10, hp:10, mp:10, wAtk:20, mAtk:0, wDef:10, mDef:10, acc:10, avoid:0, exp:1, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9400630, name:"Event Horntail's Left Head", level:60, hp:1000000, mp:500, wAtk:350, mAtk:320, wDef:700, mDef:600, acc:250, avoid:10, exp:10000, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:4230400, name:"Iron Boar", level:45, hp:2650, mp:0, wAtk:150, mAtk:0, wDef:350, mDef:350, acc:195, avoid:20, exp:115, weak:"-", strong:"-", immune:"-", boss:false, location:"4 maps", undead:false, auto:true },
  { id:4230501, name:"Red Porky", level:41, hp:2000, mp:150, wAtk:125, mAtk:0, wDef:120, mDef:150, acc:150, avoid:15, exp:99, weak:"-", strong:"-", immune:"-", boss:false, location:"3 maps", undead:false, auto:true },
  { id:9400247, name:"Drumming Bunny", level:30, hp:950, mp:0, wAtk:100, mAtk:0, wDef:38, mDef:40, acc:65, avoid:12, exp:60, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9500355, name:"Eliza", level:83, hp:87000, mp:320, wAtk:420, mAtk:400, wDef:600, mDef:450, acc:150, avoid:30, exp:2800, weak:"-", strong:"-", immune:"-", boss:true, location:"30 maps", undead:false, auto:true },
  { id:8220011, name:"Aufheben", level:85, hp:410000, mp:1500, wAtk:530, mAtk:670, wDef:700, mDef:200, acc:200, avoid:32, exp:4300, weak:"Ice", strong:"-", immune:"-", boss:true, location:"1 map", undead:false, auto:true },
  { id:9500351, name:"Papa Pixie", level:65, hp:672000, mp:60000, wAtk:270, mAtk:290, wDef:450, mDef:520, acc:190, avoid:18, exp:17000, weak:"-", strong:"-", immune:"-", boss:true, location:"30 maps", undead:false, auto:true },
  { id:9500157, name:"Jr. Wraith", level:35, hp:1200, mp:80, wAtk:110, mAtk:0, wDef:90, mDef:90, acc:100, avoid:17, exp:70, weak:"Holy", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:true, auto:true },
  { id:6090002, name:"Bamboo Warrior", level:68, hp:86890, mp:2000, wAtk:200, mAtk:290, wDef:190, mDef:270, acc:130, avoid:70, exp:17000, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:true, auto:true },
  { id:8220002, name:"Chimera", level:85, hp:96000, mp:350, wAtk:430, mAtk:430, wDef:700, mDef:465, acc:160, avoid:27, exp:3000, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9500180, name:"Papulatus", level:90, hp:353500, mp:1000, wAtk:195, mAtk:180, wDef:170, mDef:160, acc:180, avoid:0, exp:18200, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9500189, name:"Gift Box", level:30, hp:100, mp:0, wAtk:95, mAtk:100, wDef:60, mDef:50, acc:80, avoid:1, exp:50, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9400650, name:"Possessed Bear Doll", level:50, hp:2950, mp:100, wAtk:170, mAtk:0, wDef:150, mDef:180, acc:100, avoid:28, exp:140, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9200017, name:"Pink Tanny", level:32, hp:1050, mp:0, wAtk:105, mAtk:0, wDef:50, mDef:70, acc:80, avoid:14, exp:65, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300208, name:"Snowman", level:90, hp:120000, mp:300, wAtk:450, mAtk:430, wDef:800, mDef:500, acc:195, avoid:38, exp:5200, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:8140702, name:"Rexton", level:95, hp:50000, mp:200, wAtk:460, mAtk:510, wDef:840, mDef:550, acc:200, avoid:37, exp:2280, weak:"Lightning", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9300251, name:"Lucida", level:73, hp:15500, mp:240, wAtk:280, mAtk:315, wDef:300, mDef:320, acc:160, avoid:28, exp:320, weak:"Holy", strong:"-", immune:"Poison", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300056, name:"Luster Pixie in Tower of Goddess(Summon Boss)", level:56, hp:7200, mp:200, wAtk:160, mAtk:170, wDef:180, mDef:160, acc:124, avoid:22, exp:355, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300341, name:"Target Slime", level:6, hp:50, mp:35, wAtk:32, mAtk:0, wDef:5, mDef:10, acc:35, avoid:1, exp:10, weak:"Lightning", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:3400006, name:"Jr. Pepe Doll  ", level:35, hp:200, mp:0, wAtk:50, mAtk:0, wDef:50, mDef:50, acc:80, avoid:15, exp:5, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:6110300, name:"Homun", level:65, hp:11000, mp:80, wAtk:182, mAtk:270, wDef:170, mDef:245, acc:110, avoid:24, exp:255, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9500169, name:"Jr. Balrog", level:30, hp:3094, mp:500, wAtk:95, mAtk:90, wDef:20, mDef:10, acc:150, avoid:0, exp:263, weak:"Holy", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9500149, name:"Coke Golem", level:50, hp:3600, mp:120, wAtk:150, mAtk:0, wDef:170, mDef:180, acc:120, avoid:24, exp:136, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300297, name:"Mutae of the Maze", level:10, hp:10, mp:10, wAtk:20, mAtk:0, wDef:10, mDef:10, acc:10, avoid:0, exp:1, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9400246, name:"Horny Mushroom", level:22, hp:300, mp:35, wAtk:90, mAtk:0, wDef:30, mDef:0, acc:55, avoid:7, exp:35, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9400241, name:"Pig", level:7, hp:75, mp:40, wAtk:37, mAtk:0, wDef:5, mDef:20, acc:40, avoid:0, exp:15, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9500163, name:"Blood Harp", level:83, hp:30000, mp:160, wAtk:365, mAtk:400, wDef:700, mDef:465, acc:150, avoid:27, exp:1100, weak:"Ice", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9400639, name:"Dead Scarecrow", level:50, hp:3300, mp:120, wAtk:190, mAtk:140, wDef:155, mDef:170, acc:175, avoid:20, exp:220, weak:"-", strong:"-", immune:"-", boss:false, location:"8 maps", undead:true, auto:true },
  { id:7130020, name:"Goby", level:85, hp:17000, mp:150, wAtk:370, mAtk:0, wDef:645, mDef:430, acc:160, avoid:29, exp:1400, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9500348, name:"Nine-Tailed Fox", level:70, hp:89000, mp:200, wAtk:260, mAtk:310, wDef:280, mDef:265, acc:130, avoid:25, exp:1300, weak:"-", strong:"-", immune:"-", boss:true, location:"30 maps", undead:false, auto:true },
  { id:8141000, name:"Spirit Viking", level:93, hp:50000, mp:190, wAtk:430, mAtk:480, wDef:830, mDef:530, acc:200, avoid:37, exp:2100, weak:"Lightning", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:7130600, name:"Hobi", level:72, hp:15000, mp:150, wAtk:270, mAtk:310, wDef:330, mDef:260, acc:160, avoid:25, exp:295, weak:"Poison", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:9400215, name:"Ultra Gray (JP)", level:45, hp:2550, mp:170, wAtk:145, mAtk:155, wDef:185, mDef:200, acc:210, avoid:21, exp:110, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300079, name:"Nest Golem in Cave", level:110, hp:80000, mp:240, wAtk:580, mAtk:650, wDef:900, mDef:600, acc:210, avoid:38, exp:1500, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300248, name:"Sage Cat", level:66, hp:9000, mp:200, wAtk:220, mAtk:270, wDef:160, mDef:200, acc:120, avoid:24, exp:255, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:8200009, name:"Oblivion Monk", level:121, hp:115000, mp:300, wAtk:605, mAtk:685, wDef:740, mDef:870, acc:215, avoid:41, exp:5750, weak:"Poison", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:6230101, name:"Puco", level:63, hp:20000, mp:100, wAtk:257, mAtk:0, wDef:200, mDef:220, acc:145, avoid:36, exp:190, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9500105, name:"Green Mushroom", level:15, hp:250, mp:25, wAtk:82, mAtk:0, wDef:12, mDef:40, acc:45, avoid:5, exp:26, weak:"-", strong:"-", immune:"Poison", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300126, name:"Lord Pirate's Enraged Ginseng Jar", level:59, hp:9500, mp:160, wAtk:155, mAtk:0, wDef:190, mDef:220, acc:150, avoid:19, exp:105, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:8090000, name:"Deet and Roi", level:80, hp:175000, mp:300, wAtk:350, mAtk:410, wDef:650, mDef:450, acc:140, avoid:120, exp:850, weak:"-", strong:"-", immune:"-", boss:true, location:"1 map", undead:false, auto:true },
  { id:9400648, name:"Possessed Bear Doll", level:30, hp:1300, mp:100, wAtk:100, mAtk:0, wDef:38, mDef:40, acc:65, avoid:12, exp:60, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300019, name:"Master Muscle Stone", level:65, hp:40000, mp:180, wAtk:285, mAtk:0, wDef:380, mDef:560, acc:145, avoid:23, exp:1120, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9300013, name:"King Block Golem from Another Dimension", level:200, hp:99999, mp:0, wAtk:999, mAtk:0, wDef:999, mDef:999, acc:999, avoid:999, exp:1, weak:"-", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:6130102, name:"Separated Pepe", level:60, hp:7200, mp:100, wAtk:167, mAtk:0, wDef:210, mDef:225, acc:200, avoid:30, exp:420, weak:"Fire", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300313, name:"Witch Cat", level:200, hp:10, mp:10, wAtk:0, mAtk:0, wDef:0, mDef:10, acc:999, avoid:0, exp:1, weak:"-", strong:"-", immune:"-", boss:true, location:"1 map", undead:false, auto:true },
  { id:9500304, name:"Mirror Ghost 3", level:20, hp:350, mp:30, wAtk:1, mAtk:0, wDef:10, mDef:60, acc:999, avoid:999, exp:1, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9500357, name:"Snow Yeti", level:90, hp:120000, mp:300, wAtk:450, mAtk:430, wDef:800, mDef:500, acc:195, avoid:38, exp:5200, weak:"-", strong:"-", immune:"-", boss:true, location:"30 maps", undead:false, auto:true },
  { id:8200010, name:"Oblivion Monk Trainee", level:124, hp:123000, mp:320, wAtk:620, mAtk:700, wDef:760, mDef:910, acc:220, avoid:43, exp:6150, weak:"Poison", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:7220005, name:"Bergamot", level:77, hp:40000, mp:700, wAtk:340, mAtk:370, wDef:600, mDef:440, acc:160, avoid:28, exp:3000, weak:"Lightning", strong:"-", immune:"Poison", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:7120105, name:"Gold Slime  ", level:72, hp:15200, mp:100, wAtk:272, mAtk:320, wDef:320, mDef:265, acc:175, avoid:30, exp:354, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9300106, name:"Enraged Lord Pirate", level:68, hp:540000, mp:500, wAtk:290, mAtk:350, wDef:710, mDef:495, acc:170, avoid:22, exp:12000, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9300010, name:"Rombad from Another Dimension", level:47, hp:33000, mp:220, wAtk:175, mAtk:195, wDef:185, mDef:200, acc:150, avoid:18, exp:850, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:8810022, name:"Green Cornian", level:100, hp:56000, mp:200, wAtk:480, mAtk:0, wDef:800, mDef:500, acc:205, avoid:45, exp:1000, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:6130208, name:"Kru", level:68, hp:12500, mp:100, wAtk:200, mAtk:290, wDef:190, mDef:250, acc:130, avoid:26, exp:265, weak:"-", strong:"-", immune:"-", boss:false, location:"4 maps", undead:false, auto:true },
  { id:9300211, name:"Manon", level:105, hp:3700000, mp:1500, wAtk:550, mAtk:680, wDef:900, mDef:850, acc:200, avoid:39, exp:13500, weak:"Ice", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:2230110, name:"Wooden Mask", level:23, hp:500, mp:0, wAtk:85, mAtk:0, wDef:30, mDef:40, acc:55, avoid:10, exp:42, weak:"-", strong:"-", immune:"-", boss:false, location:"3 maps", undead:false, auto:true },
  { id:9300015, name:"Cronos", level:37, hp:2750, mp:30, wAtk:117, mAtk:0, wDef:90, mDef:120, acc:135, avoid:22, exp:82, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:true, auto:true },
  { id:8120105, name:"Maverick Type S", level:88, hp:37000, mp:200, wAtk:390, mAtk:430, wDef:800, mDef:495, acc:170, avoid:28, exp:1920, weak:"-", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:9300226, name:"Zombie Lupin", level:40, hp:1800, mp:100, wAtk:120, mAtk:135, wDef:70, mDef:70, acc:110, avoid:25, exp:90, weak:"Holy", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:true, auto:true },
  { id:9300192, name:"Alishar", level:56, hp:125000, mp:2500, wAtk:280, mAtk:260, wDef:210, mDef:240, acc:160, avoid:26, exp:4800, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9500195, name:"Jack-o-Lantern", level:10, hp:10, mp:0, wAtk:60, mAtk:60, wDef:10, mDef:30, acc:40, avoid:1, exp:16, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9500352, name:"King Sage Cat", level:77, hp:108000, mp:520, wAtk:320, mAtk:350, wDef:520, mDef:410, acc:160, avoid:27, exp:2280, weak:"-", strong:"-", immune:"-", boss:true, location:"30 maps", undead:false, auto:true },
  { id:9300147, name:"Homunculus", level:77, hp:20000, mp:240, wAtk:260, mAtk:250, wDef:300, mDef:320, acc:160, avoid:28, exp:320, weak:"-", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:9500113, name:"Panda Teddy", level:36, hp:1400, mp:0, wAtk:120, mAtk:0, wDef:95, mDef:95, acc:100, avoid:16, exp:77, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9500136, name:"Gigantic Viking", level:98, hp:58000, mp:220, wAtk:460, mAtk:520, wDef:845, mDef:580, acc:205, avoid:38, exp:2600, weak:"Lightning", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:3400007, name:"Transformed Doll Claw Game", level:39, hp:200, mp:100, wAtk:50, mAtk:50, wDef:100, mDef:100, acc:50, avoid:15, exp:5, weak:"-", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:8150301, name:"Blue Wyvern", level:101, hp:57000, mp:250, wAtk:495, mAtk:535, wDef:850, mDef:570, acc:205, avoid:38, exp:3050, weak:"Fire", strong:"-", immune:"-", boss:false, location:"5 maps", undead:false, auto:true },
  { id:9420000, name:"Toad", level:28, hp:720, mp:100, wAtk:105, mAtk:0, wDef:60, mDef:73, acc:115, avoid:12, exp:58, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:5100003, name:"Hodori", level:50, hp:3800, mp:40, wAtk:170, mAtk:0, wDef:150, mDef:180, acc:100, avoid:28, exp:140, weak:"-", strong:"-", immune:"-", boss:false, location:"6 maps", undead:false, auto:true },
  { id:9300047, name:"Luster Pixie in Tower of Goddess", level:56, hp:7200, mp:200, wAtk:160, mAtk:170, wDef:180, mDef:160, acc:124, avoid:22, exp:355, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9500371, name:"Mateon", level:15, hp:480, mp:150, wAtk:130, mAtk:135, wDef:120, mDef:120, acc:160, avoid:16, exp:99, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300054, name:"Lunar Pixie in Tower of Goddess(Summon Boss)", level:54, hp:6600, mp:200, wAtk:155, mAtk:165, wDef:175, mDef:140, acc:122, avoid:21, exp:335, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300281, name:"Transforming Green Snail of the Maze", level:10, hp:10, mp:10, wAtk:20, mAtk:0, wDef:10, mDef:10, acc:10, avoid:0, exp:1, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9400217, name:"Flyeye (JP)", level:41, hp:1600, mp:80, wAtk:135, mAtk:0, wDef:100, mDef:110, acc:160, avoid:28, exp:95, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:2100102, name:"Jr. Cactus", level:22, hp:450, mp:0, wAtk:90, mAtk:0, wDef:30, mDef:30, acc:55, avoid:8, exp:37, weak:"Fire", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:8220007, name:"Blue Mushmom", level:90, hp:135000, mp:190, wAtk:450, mAtk:540, wDef:810, mDef:520, acc:200, avoid:45, exp:5500, weak:"Fire", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:4230109, name:"Block Golem", level:42, hp:2400, mp:0, wAtk:135, mAtk:0, wDef:110, mDef:90, acc:95, avoid:12, exp:102, weak:"Fire", strong:"-", immune:"-", boss:false, location:"6 maps", undead:false, auto:true },
  { id:9300187, name:"King Slime", level:40, hp:8000, mp:100, wAtk:130, mAtk:165, wDef:160, mDef:160, acc:140, avoid:10, exp:800, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9300360, name:"Grii Gingerman", level:1, hp:10, mp:0, wAtk:0, mAtk:0, wDef:50, mDef:70, acc:110, avoid:12, exp:1, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:5120000, name:"Luster Pixie", level:52, hp:4000, mp:200, wAtk:160, mAtk:170, wDef:125, mDef:265, acc:130, avoid:22, exp:155, weak:"-", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:9300271, name:"Target Slime", level:6, hp:50, mp:35, wAtk:32, mAtk:0, wDef:5, mDef:10, acc:35, avoid:1, exp:10, weak:"Lightning", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9410007, name:"Green Bubble Tea", level:38, hp:1900, mp:100, wAtk:120, mAtk:135, wDef:105, mDef:120, acc:140, avoid:15, exp:88, weak:"Lightning", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9400103, name:"Extra D", level:72, hp:15100, mp:200, wAtk:270, mAtk:315, wDef:320, mDef:205, acc:170, avoid:18, exp:465, weak:"Fire", strong:"-", immune:"-", boss:false, location:"4 maps", undead:false, auto:true },
  { id:9400587, name:"Phantom Tree", level:50, hp:3500, mp:50, wAtk:140, mAtk:0, wDef:150, mDef:200, acc:150, avoid:10, exp:122, weak:"Fire", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300097, name:"Goby in Warped Dimension", level:85, hp:17000, mp:150, wAtk:370, mAtk:0, wDef:645, mDef:430, acc:160, avoid:29, exp:1400, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:100121, name:"Tiv", level:3, hp:25, mp:0, wAtk:22, mAtk:0, wDef:0, mDef:0, acc:30, avoid:0, exp:7, weak:"-", strong:"-", immune:"-", boss:false, location:"4 maps", undead:false, auto:true },
  { id:4230116, name:"Barnard Gray", level:40, hp:1930, mp:130, wAtk:120, mAtk:140, wDef:140, mDef:160, acc:170, avoid:18, exp:95, weak:"-", strong:"-", immune:"-", boss:false, location:"4 maps", undead:false, auto:true },
  { id:9500179, name:"Transformed Snack Bar", level:40, hp:5810, mp:1000, wAtk:80, mAtk:70, wDef:40, mDef:10, acc:140, avoid:0, exp:532, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9300017, name:"Master Cronos", level:46, hp:3600, mp:70, wAtk:130, mAtk:160, wDef:170, mDef:200, acc:155, avoid:26, exp:115, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:true, auto:true },
  { id:9500333, name:"Leviathan", level:50, hp:30000, mp:260, wAtk:140, mAtk:150, wDef:170, mDef:200, acc:80, avoid:15, exp:675, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:5150000, name:"Mixed Golem", level:59, hp:6000, mp:150, wAtk:200, mAtk:190, wDef:160, mDef:220, acc:100, avoid:20, exp:210, weak:"-", strong:"-", immune:"-", boss:false, location:"4 maps", undead:false, auto:true },
  { id:9500158, name:"Yellow King Goblin", level:70, hp:25000, mp:200, wAtk:285, mAtk:335, wDef:280, mDef:280, acc:120, avoid:15, exp:400, weak:"Ice", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:8140101, name:"Black Kentaurus", level:88, hp:37000, mp:200, wAtk:390, mAtk:430, wDef:800, mDef:495, acc:170, avoid:28, exp:1600, weak:"Holy", strong:"-", immune:"-", boss:false, location:"6 maps", undead:true, auto:true },
  { id:9500181, name:"Papulatus", level:90, hp:211400, mp:500, wAtk:195, mAtk:180, wDef:170, mDef:160, acc:180, avoid:0, exp:24647, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9300189, name:"Faust", level:50, hp:9800, mp:100, wAtk:165, mAtk:0, wDef:110, mDef:150, acc:100, avoid:20, exp:410, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9500103, name:"Bubbling", level:15, hp:240, mp:10, wAtk:80, mAtk:0, wDef:40, mDef:50, acc:80, avoid:10, exp:26, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300066, name:"Green Cornian 2 in Cave", level:100, hp:56000, mp:200, wAtk:480, mAtk:0, wDef:800, mDef:500, acc:205, avoid:45, exp:1000, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9300144, name:"Reinforced Mithril Mutae", level:47, hp:23000, mp:240, wAtk:250, mAtk:200, wDef:290, mDef:300, acc:130, avoid:20, exp:300, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9001004, name:"Shadow Kyrin", level:80, hp:130000, mp:410, wAtk:280, mAtk:0, wDef:260, mDef:115, acc:180, avoid:18, exp:2400, weak:"-", strong:"-", immune:"-", boss:true, location:"1 map", undead:false, auto:true },
  { id:9300050, name:"Flying Boogie", level:60, hp:25000, mp:200, wAtk:170, mAtk:0, wDef:225, mDef:190, acc:150, avoid:40, exp:515, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:4230111, name:"Robo", level:41, hp:2000, mp:0, wAtk:133, mAtk:0, wDef:190, mDef:175, acc:105, avoid:15, exp:99, weak:"-", strong:"-", immune:"-", boss:false, location:"7 maps", undead:false, auto:true },
  { id:9400200, name:"Malady", level:55, hp:4200, mp:90, wAtk:170, mAtk:0, wDef:100, mDef:200, acc:150, avoid:20, exp:1, weak:"Holy", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:3110302, name:"Rumo", level:35, hp:1400, mp:70, wAtk:130, mAtk:0, wDef:110, mDef:100, acc:105, avoid:18, exp:75, weak:"-", strong:"-", immune:"-", boss:false, location:"3 maps", undead:false, auto:true },
  { id:9300027, name:"Devil Slime", level:23, hp:1000, mp:0, wAtk:95, mAtk:0, wDef:30, mDef:40, acc:55, avoid:8, exp:170, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9300375, name:"Witch Bear", level:90, hp:96000, mp:350, wAtk:400, mAtk:430, wDef:700, mDef:465, acc:160, avoid:27, exp:3000, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9500191, name:"Green Phantom", level:16, hp:20, mp:10, wAtk:80, mAtk:0, wDef:12, mDef:40, acc:45, avoid:1, exp:20, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:true, auto:true },
  { id:9400551, name:"Bob", level:2, hp:777, mp:0, wAtk:22, mAtk:0, wDef:0, mDef:0, acc:20, avoid:0, exp:7, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9500153, name:"Coketump", level:25, hp:560, mp:0, wAtk:90, mAtk:0, wDef:35, mDef:40, acc:55, avoid:8, exp:43, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9500142, name:"Separated Pepe", level:60, hp:7200, mp:100, wAtk:167, mAtk:0, wDef:210, mDef:225, acc:200, avoid:30, exp:420, weak:"Fire", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9500313, name:"Tae Roon", level:71, hp:93000, mp:200, wAtk:285, mAtk:310, wDef:335, mDef:265, acc:175, avoid:30, exp:1580, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9420509, name:"Pac Pinky", level:58, hp:5000, mp:150, wAtk:180, mAtk:0, wDef:160, mDef:200, acc:70, avoid:18, exp:200, weak:"Holy", strong:"-", immune:"-", boss:false, location:"2 maps", undead:true, auto:true },
  { id:9400556, name:"Glutton Ghoul", level:21, hp:300, mp:20, wAtk:90, mAtk:0, wDef:20, mDef:20, acc:85, avoid:10, exp:37, weak:"-", strong:"-", immune:"-", boss:false, location:"5 maps", undead:false, auto:true },
  { id:9300108, name:"Lord Pirate's Jar", level:56, hp:4300, mp:150, wAtk:145, mAtk:0, wDef:180, mDef:200, acc:135, avoid:18, exp:92, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9300290, name:"Lilynouch of Competence", level:90, hp:220000, mp:300, wAtk:450, mAtk:430, wDef:800, mDef:500, acc:195, avoid:38, exp:5200, weak:"Lightning", strong:"-", immune:"-", boss:true, location:"1 map", undead:false, auto:true },
  { id:6400001, name:"Transformed Dark Yeti", level:68, hp:13000, mp:100, wAtk:210, mAtk:290, wDef:190, mDef:270, acc:130, avoid:26, exp:445, weak:"Holy", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9410008, name:"Yeti UFO Catcher", level:50, hp:3800, mp:50, wAtk:175, mAtk:160, wDef:160, mDef:210, acc:152, avoid:20, exp:135, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300291, name:"Advanced Manon", level:100, hp:560000, mp:500, wAtk:500, mAtk:550, wDef:800, mDef:800, acc:180, avoid:40, exp:3500, weak:"Ice", strong:"-", immune:"-", boss:true, location:"1 map", undead:false, auto:true },
  { id:9500119, name:"Toy Trojan", level:39, hp:1920, mp:0, wAtk:124, mAtk:0, wDef:110, mDef:130, acc:135, avoid:18, exp:92, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9500122, name:"Chief Gray", level:49, hp:9000, mp:220, wAtk:140, mAtk:180, wDef:140, mDef:250, acc:140, avoid:25, exp:580, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300312, name:"Pigmy that lays Golden Eggs", level:10, hp:10, mp:10, wAtk:20, mAtk:0, wDef:10, mDef:10, acc:10, avoid:0, exp:1, weak:"-", strong:"-", immune:"-", boss:true, location:"1 map", undead:false, auto:true },
  { id:9300195, name:"Papa Pixie", level:65, hp:672000, mp:60000, wAtk:270, mAtk:290, wDef:450, mDef:520, acc:190, avoid:18, exp:17000, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9500301, name:"Destroyed Doll", level:100, hp:10, mp:0, wAtk:40, mAtk:40, wDef:10, mDef:10, acc:40, avoid:1, exp:12, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300059, name:"Ribbon Pig", level:10, hp:120, mp:45, wAtk:70, mAtk:0, wDef:10, mDef:30, acc:40, avoid:2, exp:20, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9300347, name:"Giant Nependeath", level:45, hp:5000, mp:120, wAtk:140, mAtk:155, wDef:150, mDef:160, acc:195, avoid:16, exp:110, weak:"Fire", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9400547, name:"Boomer", level:27, hp:700, mp:40, wAtk:105, mAtk:0, wDef:45, mDef:75, acc:75, avoid:10, exp:55, weak:"Ice", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:9300268, name:"Tae Roon", level:71, hp:93000, mp:200, wAtk:285, mAtk:310, wDef:335, mDef:265, acc:175, avoid:30, exp:1580, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9300092, name:"Jr. Balrog in Forgotten Shrine", level:80, hp:50000, mp:500, wAtk:450, mAtk:605, wDef:420, mDef:450, acc:150, avoid:30, exp:2000, weak:"Holy", strong:"-", immune:"Poison", boss:true, location:"1 map", undead:false, auto:true },
  { id:9420500, name:"Stopnow", level:28, hp:700, mp:50, wAtk:100, mAtk:0, wDef:35, mDef:70, acc:60, avoid:10, exp:50, weak:"-", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:9200019, name:"White Fang", level:58, hp:5800, mp:100, wAtk:170, mAtk:205, wDef:200, mDef:220, acc:150, avoid:25, exp:220, weak:"Fire", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:3400005, name:"Jr. Pepe Doll Claw Game", level:38, hp:1700, mp:100, wAtk:125, mAtk:130, wDef:120, mDef:110, acc:110, avoid:18, exp:100, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9400245, name:"Zombie Mushroom", level:24, hp:500, mp:50, wAtk:95, mAtk:0, wDef:20, mDef:30, acc:50, avoid:8, exp:42, weak:"Holy", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:true, auto:true },
  { id:6300005, name:"Zombie Mushmom", level:65, hp:35000, mp:220, wAtk:250, mAtk:380, wDef:350, mDef:400, acc:155, avoid:30, exp:1500, weak:"-", strong:"-", immune:"-", boss:true, location:"1 map", undead:true, auto:true },
  { id:9400204, name:"Red Slime", level:55, hp:6000, mp:100, wAtk:210, mAtk:190, wDef:200, mDef:220, acc:150, avoid:25, exp:240, weak:"Ice", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:9400011, name:"Paper Lantern Ghost", level:40, hp:1920, mp:50, wAtk:120, mAtk:145, wDef:140, mDef:160, acc:150, avoid:25, exp:93, weak:"Ice", strong:"-", immune:"-", boss:false, location:"1 map", undead:true, auto:true },
  { id:9400546, name:"I.AM.ROBOT", level:44, hp:2490, mp:100, wAtk:130, mAtk:140, wDef:150, mDef:195, acc:180, avoid:30, exp:120, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9300260, name:"Jr. Balrog", level:80, hp:50000, mp:500, wAtk:450, mAtk:605, wDef:420, mDef:450, acc:150, avoid:30, exp:2000, weak:"Holy", strong:"-", immune:"Poison", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:8500002, name:"Papulatus", level:125, hp:1590000, mp:80, wAtk:800, mAtk:1000, wDef:800, mDef:1200, acc:230, avoid:40, exp:970000, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:8200000, name:"Eye of Time", level:80, hp:24000, mp:300, wAtk:350, mAtk:410, wDef:650, mDef:450, acc:140, avoid:30, exp:850, weak:"-", strong:"-", immune:"-", boss:false, location:"14 maps", undead:false, auto:true },
  { id:9001003, name:"Dark Lord's Clone", level:80, hp:120000, mp:510, wAtk:260, mAtk:0, wDef:260, mDef:220, acc:180, avoid:32, exp:2400, weak:"-", strong:"-", immune:"-", boss:true, location:"1 map", undead:false, auto:true },
  { id:9300232, name:"Tick", level:34, hp:1100, mp:0, wAtk:115, mAtk:0, wDef:95, mDef:90, acc:90, avoid:14, exp:70, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:2230106, name:"Cico", level:25, hp:550, mp:0, wAtk:95, mAtk:0, wDef:30, mDef:40, acc:50, avoid:8, exp:42, weak:"Poison", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:9300064, name:"Goblin Fire", level:11, hp:155, mp:40, wAtk:35, mAtk:0, wDef:10, mDef:40, acc:40, avoid:3, exp:22, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9500360, name:"Griffey", level:105, hp:3700000, mp:1500, wAtk:550, mAtk:680, wDef:900, mDef:850, acc:200, avoid:39, exp:13500, weak:"Poison", strong:"-", immune:"-", boss:true, location:"30 maps", undead:false, auto:true },
  { id:9500155, name:"Three-Tailed Fox", level:56, hp:4500, mp:120, wAtk:165, mAtk:180, wDef:150, mDef:190, acc:135, avoid:28, exp:185, weak:"Fire", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9400238, name:"Drumming Bunny", level:30, hp:950, mp:0, wAtk:100, mAtk:0, wDef:38, mDef:40, acc:65, avoid:12, exp:60, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9500331, name:"Papulatus", level:55, hp:46000, mp:300, wAtk:165, mAtk:175, wDef:120, mDef:120, acc:100, avoid:15, exp:850, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9300057, name:"Cellion in Tower of Goddess", level:54, hp:4400, mp:200, wAtk:150, mAtk:165, wDef:180, mDef:130, acc:120, avoid:20, exp:170, weak:"Ice", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:3300000, name:"Renegade Spores", level:30, hp:750, mp:0, wAtk:80, mAtk:0, wDef:25, mDef:32, acc:65, avoid:10, exp:63, weak:"-", strong:"-", immune:"-", boss:false, location:"3 maps", undead:false, auto:true },
  { id:4130103, name:"Rombot", level:47, hp:11000, mp:220, wAtk:165, mAtk:185, wDef:165, mDef:180, acc:135, avoid:16, exp:720, weak:"-", strong:"-", immune:"-", boss:true, location:"1 map", undead:false, auto:true },
  { id:9300242, name:"Captain", level:70, hp:15000, mp:100, wAtk:210, mAtk:320, wDef:250, mDef:260, acc:165, avoid:26, exp:282, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300191, name:"Mushmom", level:60, hp:20000, mp:200, wAtk:200, mAtk:300, wDef:320, mDef:320, acc:150, avoid:27, exp:1200, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9200013, name:"Cold Eye (PC)", level:40, hp:2000, mp:50, wAtk:130, mAtk:0, wDef:80, mDef:80, acc:65, avoid:15, exp:85, weak:"Fire", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300229, name:"Orange Mushroom", level:8, hp:80, mp:45, wAtk:42, mAtk:0, wDef:0, mDef:10, acc:42, avoid:1, exp:15, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300200, name:"Tae Roon", level:71, hp:93000, mp:200, wAtk:285, mAtk:310, wDef:335, mDef:265, acc:175, avoid:30, exp:1580, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9300319, name:"Klock", level:59, hp:7500, mp:120, wAtk:170, mAtk:220, wDef:175, mDef:170, acc:110, avoid:22, exp:5, weak:"Holy", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9300228, name:"Clang", level:48, hp:3000, mp:50, wAtk:160, mAtk:0, wDef:120, mDef:150, acc:150, avoid:20, exp:128, weak:"Lightning", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:2100103, name:"Cactus", level:25, hp:550, mp:0, wAtk:95, mAtk:0, wDef:35, mDef:40, acc:55, avoid:9, exp:47, weak:"Fire", strong:"-", immune:"-", boss:false, location:"3 maps", undead:false, auto:true },
  { id:2230109, name:"Bubble Fish", level:28, hp:740, mp:40, wAtk:100, mAtk:0, wDef:35, mDef:40, acc:55, avoid:10, exp:52, weak:"Lightning", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:9400013, name:"Dreamy Ghost", level:100, hp:68000, mp:350, wAtk:480, mAtk:540, wDef:810, mDef:580, acc:210, avoid:34, exp:3200, weak:"Holy", strong:"-", immune:"Poison", boss:false, location:"1 map", undead:true, auto:true },
  { id:8200002, name:"Memory Monk Trainee", level:94, hp:45000, mp:200, wAtk:420, mAtk:510, wDef:660, mDef:720, acc:195, avoid:37, exp:2200, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9400712, name:"Little Snowman", level:10, hp:10, mp:0, wAtk:60, mAtk:60, wDef:10, mDef:30, acc:40, avoid:1, exp:16, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:100123, name:"Tiru", level:7, hp:70, mp:0, wAtk:37, mAtk:0, wDef:5, mDef:20, acc:40, avoid:0, exp:16, weak:"-", strong:"-", immune:"-", boss:false, location:"3 maps", undead:false, auto:true },
  { id:9300270, name:"Mingu", level:80, hp:10000, mp:300, wAtk:100, mAtk:100, wDef:100, mDef:100, acc:55, avoid:15, exp:10, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9400511, name:"Yellow Eggy Popp", level:20, hp:350, mp:0, wAtk:95, mAtk:0, wDef:10, mDef:60, acc:55, avoid:8, exp:50, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:3230302, name:"Bloctopus", level:35, hp:1300, mp:0, wAtk:105, mAtk:115, wDef:100, mDef:130, acc:125, avoid:15, exp:72, weak:"-", strong:"-", immune:"-", boss:false, location:"8 maps", undead:false, auto:true },
  { id:9300105, name:"Angry Lord Pirate", level:63, hp:480000, mp:400, wAtk:270, mAtk:330, wDef:690, mDef:475, acc:160, avoid:22, exp:8800, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9300277, name:"Blue Snail of the Maze", level:10, hp:10, mp:10, wAtk:20, mAtk:0, wDef:10, mDef:10, acc:10, avoid:0, exp:1, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:7120100, name:"Gatekeeper Nex", level:70, hp:90000, mp:150, wAtk:250, mAtk:350, wDef:250, mDef:250, acc:150, avoid:30, exp:330, weak:"-", strong:"-", immune:"-", boss:true, location:"1 map", undead:false, auto:true },
  { id:9500116, name:"Zombie Lupin", level:40, hp:1800, mp:100, wAtk:120, mAtk:135, wDef:70, mDef:70, acc:110, avoid:25, exp:90, weak:"Holy", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:true, auto:true },
  { id:9300332, name:"Barnard Gray", level:40, hp:1930, mp:130, wAtk:120, mAtk:140, wDef:140, mDef:160, acc:170, avoid:18, exp:95, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:3100101, name:"Sand Dwarf ", level:32, hp:1000, mp:0, wAtk:110, mAtk:0, wDef:45, mDef:40, acc:60, avoid:12, exp:60, weak:"Fire", strong:"-", immune:"-", boss:false, location:"3 maps", undead:false, auto:true },
  { id:9300194, name:"Dyle", level:65, hp:31000, mp:200, wAtk:190, mAtk:200, wDef:190, mDef:220, acc:150, avoid:30, exp:810, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9400552, name:"Zoo Snail", level:2, hp:777, mp:0, wAtk:22, mAtk:0, wDef:0, mDef:0, acc:20, avoid:0, exp:7, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9500185, name:"Rideword Y", level:15, hp:15, mp:0, wAtk:80, mAtk:0, wDef:10, mDef:40, acc:50, avoid:1, exp:20, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9300084, name:"Deathly Fear", level:43, hp:6500, mp:0, wAtk:130, mAtk:0, wDef:70, mDef:470, acc:120, avoid:18, exp:340, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:7130500, name:"Rash", level:70, hp:14500, mp:150, wAtk:245, mAtk:0, wDef:235, mDef:245, acc:130, avoid:25, exp:270, weak:"Poison", strong:"-", immune:"-", boss:false, location:"3 maps", undead:false, auto:true },
  { id:9410011, name:"Jr. Pepe Doll", level:36, hp:1400, mp:35, wAtk:120, mAtk:0, wDef:80, mDef:85, acc:120, avoid:10, exp:81, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9420536, name:"Froscola", level:72, hp:15200, mp:100, wAtk:270, mAtk:320, wDef:320, mDef:260, acc:172, avoid:25, exp:300, weak:"-", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:6230600, name:"Ice Drake", level:64, hp:7700, mp:130, wAtk:210, mAtk:230, wDef:200, mDef:230, acc:150, avoid:25, exp:250, weak:"Fire", strong:"-", immune:"-", boss:false, location:"3 maps", undead:false, auto:true },
  { id:9400212, name:"Stone Golem (JP)", level:55, hp:4000, mp:120, wAtk:185, mAtk:0, wDef:135, mDef:100, acc:85, avoid:15, exp:170, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:6400003, name:"Cuzco", level:69, hp:60000, mp:1000, wAtk:372, mAtk:565, wDef:320, mDef:530, acc:170, avoid:40, exp:240, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9500349, name:"Lord Pirate", level:60, hp:420000, mp:300, wAtk:250, mAtk:310, wDef:670, mDef:455, acc:140, avoid:22, exp:7200, weak:"-", strong:"-", immune:"-", boss:true, location:"30 maps", undead:false, auto:true },
  { id:9500204, name:"Zoo Ribbon Pig", level:10, hp:10000, mp:45, wAtk:0, mAtk:0, wDef:10, mDef:30, acc:40, avoid:2, exp:10, weak:"-", strong:"-", immune:"-", boss:true, location:"1 map", undead:false, auto:true },
  { id:9300309, name:"Rash of the Maze", level:10, hp:10, mp:10, wAtk:20, mAtk:0, wDef:10, mDef:10, acc:10, avoid:0, exp:1, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9300051, name:"Jr. Cellion in Tower of Goddess", level:51, hp:6400, mp:100, wAtk:145, mAtk:0, wDef:165, mDef:110, acc:115, avoid:20, exp:305, weak:"Ice", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:9400538, name:"Street Slime", level:19, hp:320, mp:20, wAtk:100, mAtk:0, wDef:40, mDef:50, acc:80, avoid:15, exp:35, weak:"-", strong:"-", immune:"-", boss:false, location:"3 maps", undead:false, auto:true },
  { id:9400599, name:"Black Bird", level:100, hp:100000, mp:40000, wAtk:650, mAtk:570, wDef:120, mDef:150, acc:250, avoid:16, exp:11000, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
  { id:9400542, name:"Fire Tusk", level:36, hp:1450, mp:250, wAtk:110, mAtk:140, wDef:70, mDef:70, acc:130, avoid:10, exp:85, weak:"Ice", strong:"-", immune:"Fire", boss:false, location:"2 maps", undead:false, auto:true },
  { id:9400657, name:"Strange Green Mushroom", level:15, hp:250, mp:25, wAtk:82, mAtk:0, wDef:12, mDef:40, acc:45, avoid:5, exp:26, weak:"-", strong:"-", immune:"Poison", boss:false, location:"1 map", undead:false, auto:true },
  { id:8140002, name:"Blood Harp", level:83, hp:30000, mp:160, wAtk:365, mAtk:400, wDef:700, mDef:465, acc:150, avoid:27, exp:1100, weak:"Ice", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:9500356, name:"Chimera", level:85, hp:96000, mp:350, wAtk:430, mAtk:430, wDef:700, mDef:465, acc:160, avoid:27, exp:3000, weak:"-", strong:"-", immune:"-", boss:true, location:"30 maps", undead:false, auto:true },
  { id:4300016, name:"Fancy Amplifier ", level:49, hp:3000, mp:250, wAtk:165, mAtk:175, wDef:185, mDef:200, acc:145, avoid:23, exp:190, weak:"-", strong:"-", immune:"-", boss:false, location:"1 map", undead:false, auto:true },
  { id:7130004, name:"Hankie", level:78, hp:20000, mp:100, wAtk:330, mAtk:365, wDef:600, mDef:450, acc:145, avoid:30, exp:400, weak:"Fire", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:8140111, name:"Dual Birk", level:88, hp:37000, mp:200, wAtk:395, mAtk:0, wDef:850, mDef:480, acc:170, avoid:28, exp:1620, weak:"-", strong:"-", immune:"-", boss:false, location:"2 maps", undead:false, auto:true },
  { id:3300003, name:"Helmet Pepe", level:32, hp:850, mp:0, wAtk:93, mAtk:0, wDef:30, mDef:36, acc:70, avoid:12, exp:71, weak:"-", strong:"-", immune:"-", boss:false, location:"5 maps", undead:false, auto:true },
  { id:6220000, name:"Dyle", level:65, hp:31000, mp:200, wAtk:190, mAtk:200, wDef:190, mDef:220, acc:150, avoid:30, exp:810, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9500310, name:"Timer", level:59, hp:21000, mp:200, wAtk:200, mAtk:205, wDef:180, mDef:230, acc:150, avoid:20, exp:650, weak:"-", strong:"-", immune:"-", boss:true, location:"Location unknown", undead:false, auto:true },
  { id:9500201, name:"Zoo Yeti", level:65, hp:11000, mp:80, wAtk:0, mAtk:0, wDef:170, mDef:245, acc:110, avoid:24, exp:10, weak:"Fire", strong:"-", immune:"-", boss:true, location:"1 map", undead:false, auto:true },
  { id:9300278, name:"Red Snail of the Maze", level:10, hp:10, mp:10, wAtk:20, mAtk:0, wDef:10, mDef:10, acc:10, avoid:0, exp:1, weak:"-", strong:"-", immune:"-", boss:false, location:"Location unknown", undead:false, auto:true },
];

// Undead monster IDs (Heal damages these as a Cleric)
// Catalog ids whose HP/MP/EXP/wAtk/mAtk/wDef/mDef/acc/avoid/level were corrected against
// the Cosmic v83 dump and confirmed to match MapleLegends' real values (see MONSTER_DB
// header comment for the verification methodology).
const STAT_VERIFIED_IDS = new Set([2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,25,26,27,28,29,30,31,32,33,34,35,36,37,38,40,41,43,44,45,46,47,48,49,50,51,52,53,1000,1001,1002,1003,1004,1005,1011,1012,1013,1014,1015,1019,1021,1025,1032,1034,1036,1039,1042,1047,1048,1052,1053,1054,1055,1056,1058,1060,1065,1072,1076,1080,1081,1087,1089,700000,700001,700004,700005]);

const UNDEAD_IDS = new Set([21, 32, 38, 43, 1025, 1034, 1047, 1058, 1065, 1072, 1076, 1081, 1087, 1089, 2230131, 4230125, 4230126, 5090000, 5130108, 5150001, 6090000, 6090002, 6090003, 6110301, 6230602, 6300005, 7090000, 7110300, 7130103, 8140101, 8140600, 8170000, 8190003, 8190004, 9200007, 9200010, 9300015, 9300016, 9300017, 9300022, 9300023, 9300028, 9300036, 9300037, 9300038, 9300075, 9300076, 9300077, 9300086, 9300098, 9300100, 9300130, 9300135, 9300146, 9300196, 9300226, 9300230, 9300231, 9300237, 9300238, 9300261, 9400003, 9400011, 9400013, 9400209, 9400210, 9400214, 9400245, 9400561, 9400562, 9400578, 9400580, 9400619, 9400638, 9400639, 9400640, 9400741, 9400742, 9420509, 9420510, 9420511, 9420512, 9500111, 9500116, 9500121, 9500127, 9500135, 9500156, 9500157, 9500164, 9500191, 9500196]);

// MP Eater (passive, 2nd job): chance to absorb % of mob's max MP per hit
// Lv N: N% chance, absorb N/2% of mob's max MP (Lv1=1%/1%, Lv20=20%/10%)
// Fires independently per hit: Magic Claw = 2 rolls, Heal vs N targets = N rolls
function mpEaterAbsorbPerProc(mpEaterLvl, mobMp) {
  return mobMp * (mpEaterLvl / 200); // absorb N/2 % of mob MP
}
function mpEaterProcChance(mpEaterLvl) {
  return mpEaterLvl / 100; // N% chance per hit
}
// Expected MP recovered per cast (accounting for multiple hits/targets)
function mpEaterExpectedReturn(mpEaterLvl, mobMp, numHits) {
  if (mpEaterLvl === 0 || mobMp === 0) return 0;
  const procChance = mpEaterProcChance(mpEaterLvl);
  const absorbPerProc = mpEaterAbsorbPerProc(mpEaterLvl, mobMp);
  return procChance * absorbPerProc * numHits;
}
// Probability of at least one MP Eater proc across N hits
function mpEaterAnyProcChance(mpEaterLvl, numHits) {
  if (mpEaterLvl === 0) return 0;
  return 1 - Math.pow(1 - mpEaterProcChance(mpEaterLvl), numHits);
}
// Net expected MP cost after MP Eater return
function netMpCost(baseMpCost, mpEaterReturn) {
  return Math.max(0, baseMpCost - mpEaterReturn);
}
// Source: community knowledge of v62 map layouts (ESTIMATED - to be replaced with Map.wz foothold data)
// healCoverage: estimated monsters hittable per Heal cast standing still at optimal position (1-6)
// platforms: number of distinct platforms/levels in the map
// layout: "flat" | "tiered" | "vertical" | "open"
// mpWater: true if map contains MP-draining water (renders Magic Claw/Heal unusable while submerged)
// notes: key training considerations
// EXP table (source: meowdb.com/msclassic/guides/exp-table-level-1-to-50, confirmed from legends.ml)
// Index = level, value = EXP required to reach next level
const EXP_TABLE = [
  0,      // lv 0 placeholder
  15,     // lv 1->2
  34,     // lv 2->3
  57,     // lv 3->4
  92,     // lv 4->5
  135,    // lv 5->6
  372,    // lv 6->7
  560,    // lv 7->8
  840,    // lv 8->9
  1242,   // lv 9->10
  1716,   // lv 10->11
  2360,   // lv 11->12
  3216,   // lv 12->13
  4200,   // lv 13->14
  5460,   // lv 14->15
  7050,   // lv 15->16
  8840,   // lv 16->17
  11040,  // lv 17->18
  13716,  // lv 18->19
  16680,  // lv 19->20
  20216,  // lv 20->21
  24402,  // lv 21->22
  28980,  // lv 22->23
  34320,  // lv 23->24
  40512,  // lv 24->25
  47216,  // lv 25->26
  54900,  // lv 26->27
  63666,  // lv 27->28
  73080,  // lv 28->29
  83720,  // lv 29->30
  95700,  // lv 30->31
  108480, // lv 31->32
  122760, // lv 32->33
  138666, // lv 33->34
  155540, // lv 34->35
  174216, // lv 35->36
  194832, // lv 36->37
  216600, // lv 37->38
  240500, // lv 38->39
  266682, // lv 39->40
  294216, // lv 40->41
  324240, // lv 41->42
  356916, // lv 42->43
  391160, // lv 43->44
  428280, // lv 44->45
  468450, // lv 45->46
  510420, // lv 46->47
  555680, // lv 47->48
  604416, // lv 48->49
  655200, // lv 49->50
];

// Given total EXP gained in a session, starting from CHAR.level with 0% progress,
// calculate levels gained and leftover % into next level
function calcLevelsGained(totalExpGained, startLevel, startExpPct) {
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
// Income per kill: meso drop avg + etc drop EV + equip drop EV (unpruned)
const INCOME_PER_KILL = 60 + (0.60 * 18) + 286.41; // ~357 mesos/kill
const MC_MP_COST_CONST = 20;
const MC_CAST_TIME_SEC = 2.0;   // seconds per Magic Claw kill (cast + reposition)
const HEAL_CAST_TIME_SEC = 3.0; // seconds per Heal cycle (cast + move to next group)

// MP-restore items available for session profit calc, verified against v62 Item.wz Consume data
// (private-server prices: some drop-only items are NPC-purchasable for convenience here)
const POTIONS = {
  bluePotion: { label: "Blue Potion (100m / 100MP)", cost: 100, mpFlat: 100, mpPct: null },
  manaElixir: { label: "Mana Elixir (310m / 300MP)", cost: 310, mpFlat: 300, mpPct: null },
  elixir: { label: "Elixir (1000m / 50% MP)", cost: 1000, mpFlat: null, mpPct: 0.5 },
  powerElixir: { label: "Power Elixir (2500m / 100% MP)", cost: 2500, mpFlat: null, mpPct: 1.0 },
};

function sessionProfit(minutes, skill, killsPerCast, netMpCostPerCast, expPerKill, charLevel, charExpPct, potionKey, charMpMax) {
  const potion = POTIONS[potionKey] || POTIONS.bluePotion;
  const mpPerPotion = potion.mpFlat != null ? potion.mpFlat : potion.mpPct * (charMpMax || 1);
  const secs = minutes * 60;
  const castTime = skill === "heal" ? HEAL_CAST_TIME_SEC : MC_CAST_TIME_SEC;
  const casts = secs / castTime;
  const kills = casts * killsPerCast;
  const potsNeeded = (casts * netMpCostPerCast) / mpPerPotion;
  const potCost = potsNeeded * potion.cost;
  const income = kills * INCOME_PER_KILL;
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

const MAP_PLATFORM_DATA = {
  // -- Kerning Subway (Stirge / Jr. Necki / Jr. Wraith / Wraith) --
  103000102: { healCoverage:5, platforms:3, layout:"flat",    mpWater:false, estimated:true, notes:"3 long flat platforms stacked closely. Monsters cluster in lanes. Excellent Heal map." },
  105060000: { healCoverage:4, platforms:2, layout:"flat",    mpWater:false, estimated:true, notes:"2 wide flat platforms. Good density, minimal movement needed." },
  105050400: { healCoverage:3, platforms:4, layout:"tiered",  mpWater:false, estimated:true, notes:"4 platforms with moderate vertical spread. Heal hits 2-3 per platform." },
  103000103: { healCoverage:4, platforms:2, layout:"flat",    mpWater:false, estimated:true, notes:"2 long platforms. Monsters spread along length but Heal range covers well." },
  103000104: { healCoverage:4, platforms:2, layout:"flat",    mpWater:false, estimated:true, notes:"Similar to Line 1 Area 2. Good flat layout." },
  103000200: { healCoverage:3, platforms:3, layout:"tiered",  mpWater:false, estimated:true, notes:"3 platforms with some vertical gap. Moderate Heal efficiency." },

  // -- Sleepywood / Ant Tunnels (Zombie Mushroom / Jr. Boogie) --
  105090200: { healCoverage:4, platforms:2, layout:"flat",    mpWater:false, estimated:true, notes:"2 wide platforms. Zombie Mushrooms cluster well. Good Heal map." },
  105090300: { healCoverage:3, platforms:3, layout:"tiered",  mpWater:false, estimated:true, notes:"3 platforms, slightly more vertical. Jr. Boogie here too - high MDEF hurts Heal." },
  105090400: { healCoverage:2, platforms:4, layout:"tiered",  mpWater:false, estimated:true, notes:"4 platforms with significant vertical spread. Heal coverage drops quickly." },
  105070000: { healCoverage:4, platforms:2, layout:"flat",    mpWater:false, estimated:true, notes:"Classic flat ant tunnel. Long single platform each level. Very good Heal map." },
  105070100: { healCoverage:4, platforms:2, layout:"flat",    mpWater:false, estimated:true, notes:"Same as Ant Tunnel I. Consistent flat layout." },
  105070200: { healCoverage:4, platforms:2, layout:"flat",    mpWater:false, estimated:true, notes:"Ant Tunnel III. Zombie Mushrooms spawn here. Flat = good Heal coverage." },
  105070300: { healCoverage:3, platforms:3, layout:"tiered",  mpWater:false, estimated:true, notes:"Ant Tunnel IV. More vertical than III. Jr. Boogie with 50 MDEF - Heal less effective." },
  105040000: { healCoverage:3, platforms:3, layout:"tiered",  mpWater:true,  estimated:true, notes:"Swampy Land. Water on the floor drains MP. Stay on platforms - limited casting area." },
  105040300: { healCoverage:3, platforms:3, layout:"tiered",  mpWater:true,  estimated:true, notes:"Swampy Area. MP water present. Must stay elevated to cast." },

  // -- Kerning City (Jr. Wraith / Wraith) --
  103000000: { healCoverage:4, platforms:3, layout:"flat",    mpWater:false, estimated:true, notes:"Kerning Sewer. 3 well-spaced flat platforms. Classic Wraith map. Good Heal coverage." },
  103010000: { healCoverage:3, platforms:4, layout:"tiered",  mpWater:false, estimated:true, notes:"Kerning Alley. More platforms with gaps. Moderate movement." },
  103020000: { healCoverage:2, platforms:5, layout:"vertical", mpWater:false, estimated:true, notes:"Abandoned Mine. Tall vertical map with rope-linked platforms. Poor Heal map - too spread out." },
  103000900: { healCoverage:4, platforms:2, layout:"flat",    mpWater:false, estimated:true, notes:"Forgotten Tunnel. 2 long flat platforms. Good Heal coverage." },
  102040000: { healCoverage:3, platforms:3, layout:"tiered",  mpWater:false, estimated:true, notes:"Construction Site. 3 platforms but irregular spacing." },

  // -- Ludibrium (Chronos / Zombie Lupin / Soul Teddy / Death Teddy) --
  221020100: { healCoverage:5, platforms:1, layout:"flat",    mpWater:false, estimated:true, notes:"Eos Tower 1F-20F. Single wide platform per floor. Monsters stack flat. Best Heal map in Ludi." },
  221020200: { healCoverage:5, platforms:1, layout:"flat",    mpWater:false, estimated:true, notes:"Eos Tower 21F-40F. Same layout. Excellent Heal coverage." },
  221020300: { healCoverage:5, platforms:1, layout:"flat",    mpWater:false, estimated:true, notes:"Eos Tower 41F-60F. Single platform. Chronos stacks well for Heal." },
  221020400: { healCoverage:5, platforms:1, layout:"flat",    mpWater:false, estimated:true, notes:"Eos Tower 61F-75F. Single platform. Best Chronos map." },
  222000000: { healCoverage:4, platforms:2, layout:"flat",    mpWater:false, estimated:true, notes:"Helios Tower 1F-20F. 2 flat platforms. Good Heal coverage." },
  220060000: { healCoverage:2, platforms:5, layout:"vertical", mpWater:false, estimated:true, notes:"Sky Terrace I. Open multi-level with large gaps. Poor Heal map - lots of jumping." },
  220060100: { healCoverage:2, platforms:5, layout:"vertical", mpWater:false, estimated:true, notes:"Sky Terrace II. Same open vertical layout. Not ideal for Heal." },
  221020000: { healCoverage:3, platforms:3, layout:"tiered",  mpWater:false, estimated:true, notes:"Eos Tower 76F-90F. Multiple platforms. Zombie Lupins but tiered layout reduces Heal hits." },

  // -- Aqua Road (non-undead but listed for reference - all MP water maps) --
  105030000: { healCoverage:2, platforms:3, layout:"tiered",  mpWater:true,  estimated:true, notes:"Deep Forest. MP water floor. Must stay on platforms to cast." },

  // -- Zombie Mushmom / Rotten Mushmom boss rooms --
  105090900: { healCoverage:2, platforms:3, layout:"tiered",  mpWater:false, estimated:true, notes:"Boss sanctuary. Avoid solo - boss room only." },

  // -- Perion / Ellinia (non-undead reference maps) --
  101030402: { healCoverage:2, platforms:4, layout:"tiered",  mpWater:false, estimated:true, notes:"Rocky Mountain. Multiple scattered platforms. Not a Heal map." },
  100030000: { healCoverage:3, platforms:3, layout:"tiered",  mpWater:false, estimated:true, notes:"Forest of Evil Eye. 3 tiered platforms. Moderate layout." },
};

const healCoverageColor = n => n >= 5 ? "#22c55e" : n >= 4 ? "#84cc16" : n >= 3 ? "#eab308" : "#ef4444";
const scoreColor = n => n >= 4 ? "#4ade80" : n === 3 ? "#facc15" : "#f87171";

// Unified spawn-map lookup: prefer Map.wz-verified REAL_SPAWNS, fall back to
// the hand-curated MONSTER_MAPS. Returns {name, mapId, count, verified}[] or null.
// Real map names (from String.wz/Map.img.xml -- the same data the in-game minimap
// pulls "Street : Map Name" from) take priority over any hand-typed name, since
// they're ground truth: a hand-curated entry earlier in this project mislabeled
// map 100020000 as "Henesys Pig Farm" when the real Pig Farm is 100020100.
function realMapName(mapId) {
  return (typeof MAP_NAMES !== "undefined" && MAP_NAMES[mapId]) || null;
}
function spawnMapsFor(monsterId) {
  const real = REAL_SPAWNS[monsterId];
  if (real) {
    return real.map(([mapId, count]) => ({
      name: realMapName(mapId) || `Map #${mapId}`,
      mapId, count, verified: true,
    }));
  }
  const curated = MONSTER_MAPS[monsterId];
  if (curated) {
    return curated.map(entry => ({
      ...entry,
      name: realMapName(entry.mapId) || entry.name,
      verified: false,
    }));
  }
  return null;
}
const layoutIcon = l => l === "flat" ? "[=]" : l === "tiered" ? "[~]" : l === "vertical" ? "[|]" : "[?]";
const CATALOG_TO_WZID = {"2":"100100","3":"100101","4":"120100","5":"130101","6":"130100","7":"210100","8":"1210100","9":"1210102","10":"1210101","11":"1110101","12":"1120100","13":"1110100","14":"1210103","15":"1130100","16":"2220100","17":"2300100","700004":"9300184","18":"2130103","19":"2110200","20":"2130100","21":"2230101","22":"2230102","1000":"2230103","1001":"5200000","23":"2230100","1002":"2230104","25":"3000001","26":"3000002","27":"3000003","28":"3000004","1003":"3000000","1004":"5200001","1005":"5200002","29":"3110100","30":"3210100","1011":"5300000","31":"3230100","1012":"3210200","1013":"3210201","1014":"3210202","1015":"5300001","32":"3230101","33":"3230300","34":"3230301","1019":"3230200","1021":"5400000","35":"3210800","36":"3230102","37":"4230100","700000":"9500326","38":"4230101","1032":"4230107","1036":"4230105","1039":"4230108","40":"4130100","1042":"4230106","41":"4130101","43":"4230102","44":"4230104","45":"5130100","1048":"5100000","46":"5130103","1052":"5120001","1053":"5120002","1054":"5120003","47":"5300100","1055":"5130104","48":"5130101","1056":"5130105","1058":"5130107","49":"5130102","1060":"5140000","50":"6130100","51":"6230100","52":"7130100","53":"7130101","1080":"7130200","700001":"8130100","700005":"8150000","1025":"3230306","1034":"4230114","1047":"4230115","1065":"6230400","1072":"6230500","1076":"8140200","1081":"8140300","1087":"7130010","1089":"7130300"};
// Mob sprites: try local first (extracted stand/0.png, flattened via Flatten-MobThumbnails.ps1),
// falling back to legends.ml for monsters we've resolved to a real WZ id but don't have a
// local sprite for. Auto-generated rows use the real WZ id directly as their catalog id;
// curated rows need the crosswalk lookup above. Returns null (no fallback attempted) for
// the curated rows that were never crosswalked to a real WZ id at all -- using their small
// catalog number as a legends.ml id would silently fetch the wrong monster's image.
function mobWzId(m) {
  if (m.auto) return String(m.id);
  if (CATALOG_TO_WZID[m.id] !== undefined) return CATALOG_TO_WZID[m.id];
  return null;
}
const mobImg = id => `data/mobs/${id}.png`;
const mobImgFallback = wzid => `https://legends.ml/static/images/lib/monster/${wzid}.png`;

const mapImg = id => `data/thumbs/${id}.png`;
const mapImgFallback = id => `https://legends.ml/static/images/lib/map/${id}.png`;
const mapUrl = id => `https://legends.ml/lib/map?id=${id}`;

// Real, Map.wz-verified spawn data: monster catalog id -> [[mapId, spawnCount], ...]
// Derived directly from Map.wz foothold+life parsing, cross-referenced against
// Mob.wz + String.wz/Mob.img.xml (real client dump: Cosmic v83, github.com/P0nk/Cosmic)
// to resolve each catalog id's real WZ mob template id by name+level match.
// 88/105 monsters were resolved by name+level match against Mob.wz+String.wz (tolerance
// ±6 levels, to guard against duplicate names reused at different tiers, e.g. two
// different "Ligator"s). Of those 88, 85 have real spawn locations in this Map.wz dump
// (the other 3 -- Mano, Mushmom, Crimson Balrog -- are bosses that likely spawn via
// NPC/summon scripts rather than static map spawn points, so no entry here is expected).
// NOTE: monster template IDs, spawn locations, elemental typing, and undead status are
// structural/design facts that don't get rebalanced between server forks or versions,
// so this crosswalk is trusted for those fields even though Cosmic v83 is a different
// version than the MapleLegends server the numeric stats (HP/EXP/ATK/DEF) target --
// those numeric fields were deliberately left untouched by this pass (see below).
// The remaining 20/105 unresolved monsters still use the hand-curated MONSTER_MAPS below.
const REAL_SPAWNS = {"2":[[40001,23],[50000,17],[40002,15],[1010004,10],[104000100,10],[1000004,9],[104000200,8],[1020001,2]],"3":[[680010000,18],[100010000,17],[104000100,17],[104000300,16],[104000200,13],[1000004,12],[101040000,12],[104000400,12],[1010004,10],[104040000,8],[680010100,8],[1010000,6],[1000005,5],[1020001,5],[40001,4],[40002,4],[1000006,2],[50001,1]],"4":[[104030001,12],[104040000,10],[100010000,9],[680010000,9],[1010000,6],[680010100,5],[1000006,3]],"5":[[1010200,16],[104000300,15],[103010000,14],[1010004,13],[104000200,13],[104010000,12],[104040000,12],[100010000,11],[680010000,11],[101040000,9],[102010000,9],[102050000,9],[104000400,9],[104030000,9],[1000005,8],[1020001,8],[101010000,8],[680010100,8],[50001,7],[101030400,7],[1000006,5],[101010100,5],[1000004,3]],"6":[[101040000,32],[100050000,31],[910220000,29],[101030400,28],[101030000,26],[102010000,22],[910310000,20],[102020000,16],[1010100,15],[101030300,14],[101030401,12],[680010000,12],[1010004,9],[101030200,8],[101040002,4],[50001,3]],"7":[[101010101,53],[100040100,40],[101020000,36],[100040000,27],[101010000,27],[101020002,26],[101010100,25],[100040002,23],[910060000,22],[910120000,22],[100040001,21],[100050000,20],[102040000,19],[104030000,19],[103010000,17],[104020000,17],[190000000,17],[1010300,15],[191000001,14],[1000005,12],[680010000,11],[102050000,8],[103020000,8],[107000001,7],[1010004,5],[680010100,4]],"8":[[912030000,25],[104010000,23],[100030000,22],[104020000,20],[104030000,18],[103020000,15],[100010000,13],[912000000,12],[100020100,10],[104010001,10],[104040000,9],[104010002,8],[104040001,8],[100020000,6],[120010000,1]],"9":[[103020200,35],[104010000,22],[103020100,21],[100030000,19],[102040000,18],[104030001,18],[680010000,18],[102050000,16],[800010000,16],[1000006,15],[103010000,14],[104020000,13],[100000002,12],[104040002,11],[677000000,10],[677000002,10],[103020000,9],[104040001,9],[680010100,7],[100020000,4],[50001,3],[1010000,2]],"10":[[103020100,24],[103020200,14],[104040002,13],[104040001,12],[100020100,11],[103030000,11],[104010001,11],[100030000,10],[104010002,10],[677000006,9],[910060000,9]],"11":[[102030000,38],[100040000,31],[101030401,28],[101020000,25],[101030100,22],[101030000,21],[101010102,18],[101020003,17],[192000000,17],[101030200,14],[101030402,14],[192000001,12],[101010101,11],[910120000,10],[101030300,9],[680010100,9],[102010000,7],[102020000,7],[910220000,6],[101040002,4]],"12":[[101020004,19],[103030000,16],[102040000,12],[910310000,10],[677000008,9],[102040001,8],[103010001,8],[103010000,6]],"13":[[101020005,20],[191000001,18],[103030100,17],[101010102,16],[102020100,14],[800010000,13],[103000805,12],[104040002,11],[100000003,9],[103030000,9],[912030000,9],[100040003,8],[680010100,8],[100050000,7],[104040001,7],[680010000,6],[100000002,5],[104030001,4]],"14":[[103000101,64],[101020006,21],[100040004,19],[103030100,16],[103000902,9],[102040001,2],[103010001,2]],"15":[[106000000,32],[101030402,26],[101030403,20],[106000100,20],[102020100,16],[102020200,14],[101020007,12],[101030404,12],[101040002,11]],"16":[[106010000,26],[190000000,17],[100030001,15],[103030200,15],[190000002,14],[106010101,12],[100000004,11],[190000001,11],[100000003,9],[106010100,9],[800010000,7]],"17":[[103000102,38],[105060000,38],[105050400,35],[103000103,21],[103000104,18]],"18":[[107000001,23],[103000201,18],[103000200,14],[107000403,14],[107000000,4],[107000402,4],[107000100,3],[107000200,3],[107000300,3],[107000400,3],[107000401,3]],"19":[[105050300,42],[195000000,40],[105050200,38],[191000001,25],[103000805,24],[101020008,19],[106010000,19],[105060100,17],[103030200,15],[105050000,15],[105050100,15],[106010100,14],[100000004,13],[100000005,13],[105030000,12],[105050101,12],[106000300,12],[105050400,9],[105070000,9],[100030001,8],[107000500,6],[105060000,5],[105070001,4],[107000501,3]],"20":[[101030404,21],[101030403,20],[106000300,19],[101030405,15],[102020200,15],[105030000,13],[106000200,13],[102020300,11],[101040001,7],[677000004,7],[101040002,5],[107000500,5],[222010001,4],[222010002,4],[101030001,3],[222010000,3],[222010101,3],[222010102,3],[222010100,2]],"21":[[105050200,50],[195000000,36],[105060100,31],[105050100,24],[105070001,23],[105030000,18],[800020100,16],[102020300,14],[105050101,13],[105070002,13],[107000501,11],[105050000,9],[105070000,9],[106010100,8],[107000500,8],[105050400,7],[105050300,6],[105060000,6]],"22":[[101030406,33],[101030001,30],[192000000,28],[106000001,24],[101040001,22],[192000001,19],[106000101,11],[101030405,8],[101040003,4]],"1000":[[221023100,16],[221022100,11],[221023700,11],[221023000,10],[221022300,9],[221022900,6],[221023800,6],[221022000,5],[221021900,4]],"1001":[[200080200,23],[200080300,19],[200080400,17],[200081400,7],[200080600,5],[200080500,4],[200081300,3]],"23":[[105070200,41],[105070300,41],[105040000,33],[195010000,32],[105070001,31],[101020009,21],[105060100,21],[105070100,19],[105070000,16],[105070400,16],[105040100,15]],"1002":[[221022300,5],[221022900,5]],"25":[[200020000,1],[200040000,1],[200050000,1],[200080000,1]],"26":[[100000005,2],[200030000,1],[200070000,1]],"27":[[101020004,2],[101020005,2]],"28":[[106010102,3],[106010101,2],[106010106,2],[106010103,1],[106010104,1],[106010105,1]],"1003":[[200080700,18],[200080600,16],[200080800,14],[200080500,12]],"1004":[[200080900,19],[200081000,12],[200081400,11],[200081200,10]],"1005":[[200081100,17],[200081200,12],[200081300,10],[200081000,7]],"29":[[107000000,32],[107000100,24],[107000200,24],[107000300,8]],"30":[[106000002,29],[106000101,20],[192000001,17],[106000110,13],[106000001,5]],"1011":[[211000200,27],[200081500,19],[200081600,14],[200081700,14]],"31":[[105040200,39],[101020010,20],[105040100,14]],"1012":[[200010110,22],[200010100,9]],"1013":[[200010120,22],[200010100,7]],"1014":[[200010130,23],[200010100,10]],"1015":[[200081900,26],[200081800,17],[200081700,13],[200082000,4]],"32":[[103000200,83],[103000103,70],[103000201,42],[103000104,33],[103000905,12],[682000001,11],[610010100,10],[610010101,10],[610010102,10],[610010103,10],[610010104,10],[610010010,7],[610010001,6],[610010002,5],[610010012,5],[610010000,3]],"33":[[101040001,3],[103000905,1],[103000909,1]],"34":[[101040001,3],[105060100,2],[105070002,2],[105070100,2],[105070200,2],[105070300,2],[105070400,2],[105080000,2],[103000909,1]],"1019":[[200010000,36],[200020000,24],[200040000,13],[200050000,6],[200030000,1],[200060000,1]],"1021":[[200082100,21],[200082000,20],[211000200,20]],"35":[[107000401,28],[100040110,27],[110010000,27],[191000000,27],[100040101,20],[100040102,19],[105040301,16],[107000402,14],[100040103,6],[110020000,5]],"36":[[110010000,36],[110020000,35],[110020001,18],[110030000,18],[110030001,8]],"37":[[195020000,44],[105090400,23],[105040303,22],[105090301,17],[195030000,16],[105090600,15],[105090500,13],[105090700,8],[105090310,5],[105090800,5]],"38":[[191000000,51],[107000403,30],[100040101,26],[100040104,26],[105040302,26],[100040103,24],[107000402,22],[100040105,9],[100040106,3]],"1032":[[211041800,18],[211041900,15],[211041600,10],[211041700,9],[211041500,8],[230040410,7]],"1036":[[200040001,18],[200030000,8]],"1039":[[211042101,19],[211042000,14],[801010000,12],[211042200,8],[211042100,7]],"40":[[105090000,60],[105080000,14]],"1042":[[200050000,26],[200040000,19],[200070000,6],[200020000,4],[200080000,3],[200030000,1],[200060000,1]],"41":[[110040000,25],[110030001,6]],"43":[[103000202,68],[103000201,60],[103000105,56],[103000104,54],[103000909,10]],"44":[[110030000,29],[110030001,17],[110040000,13]],"45":[[195020000,26],[105090100,22],[105090000,20],[105090310,17],[105080000,13]],"1048":[[600020500,36],[211010000,23],[196000000,22],[211020000,17],[211040300,7],[211040101,6],[196010000,4],[211040100,3]],"46":[[107000300,28],[107000400,27]],"1052":[[200010111,29],[200010200,9]],"1053":[[200010121,30],[200010200,14]],"1054":[[200010131,28],[200010200,9]],"47":[[100040106,27],[100040105,21]],"1055":[[211030000,27],[211040000,21],[211040600,14],[211040500,12],[211020000,8],[211050000,6],[211010000,2]],"48":[[106010102,14],[105040305,11],[105040320,10],[106010103,9],[105040304,8],[190000001,7],[190000002,7],[106010101,4]],"1056":[[211040400,9],[211040700,9],[211040300,5]],"1058":[[211041100,26],[211041200,19],[211041300,18],[800020300,18],[211041400,16]],"49":[[105040306,9],[105040305,8],[106010104,8],[800020100,6],[106010105,5],[105040304,2],[106010103,2]],"1060":[[211050000,20],[211041000,15],[211040000,13],[196010000,12],[211040900,11],[211040800,10],[211030000,8],[211040001,5],[211040100,5],[211040500,4],[211040600,4],[196000000,1]],"50":[[105090100,25],[105090300,21]],"51":[[105090300,13],[105090301,13],[195030000,12]],"52":[[105090500,4],[105090600,4],[105090700,2],[105090800,2]],"53":[[105090800,5],[105090700,4]],"1080":[[211040500,4],[211040600,4]],"700001":[[105090900,1]],"1025":[[220040100,46],[220040300,42]],"1034":[[220050000,36],[220040000,34]],"1047":[[220050200,38],[220040400,34]],"1065":[[220070000,26]],"1072":[[220070000,14]],"1076":[[220070100,21]],"1081":[[220070100,11]],"1087":[[220070200,29]],"1089":[[220070201,15]],"9300383":[[140090300,4]],"9400205":[[800010100,1]],"9400611":[[677000011,4]],"4230201":[[230010100,7],[230010300,5],[230010200,4]],"9300109":[[925100000,5]],"9300002":[[103000804,3]],"5120501":[[251010101,16],[251010102,12],[251010200,11],[251010300,3]],"9300145":[[926100001,23],[926110001,23]],"7110300":[[261020500,2]],"9300273":[[913000200,17]],"9420502":[[540000100,12],[540000200,12]],"9400110":[[801040002,10],[801020000,5],[801040003,5],[801030000,4],[801040100,1]],"3300004":[[106021300,11],[106021100,9],[106021200,9]],"9300083":[[910010000,1]],"2230107":[[230030000,20],[230030100,20]],"5250000":[[300020200,9],[300020100,2]],"9001002":[[108010101,1]],"9400743":[[674030300,16]],"9400578":[[610030521,13],[610030520,10],[610030522,7]],"9400746":[[674030300,1]],"9400539":[[600010300,22],[600010000,19],[600010100,14]],"4300008":[[103040302,19],[103040303,18]],"9500350":[[970031400,1],[970031401,1],[970031402,1],[970031403,1],[970031404,1],[970031405,1],[970031406,1],[970031407,1],[970031408,1],[970031409,1],[970031410,1],[970031411,1],[970041400,1],[970041401,1],[970041402,1],[970041403,1],[970041404,1],[970041405,1],[970041406,1],[970041407,1],[970041408,1],[970041409,1],[970041410,1],[970041411,1],[970041412,1],[970041413,1],[970041414,1],[970041415,1],[970041416,1],[970041417,1]],"9300095":[[921100300,4]],"3100102":[[260020200,10],[260020300,9],[260020400,2]],"9400557":[[682000100,7],[682000900,5],[682000300,3],[682000500,2],[682000505,2],[682000305,1]],"9400573":[[610020004,4]],"2100107":[[260010501,22],[260010500,4]],"3000005":[[220010500,32],[220010600,23],[197010000,19],[220010400,18],[220010700,16],[220010200,7],[197000000,6],[220010000,6],[220010100,5]],"9400601":[[683000100,15]],"9300078":[[240050310,8]],"9400562":[[682000502,4],[682000501,3],[682000601,1],[682000602,1],[682000603,1]],"9400540":[[600020200,44],[600020100,25]],"100124":[[130010200,5],[130010210,5]],"5250001":[[300020000,8],[300020100,6],[300010300,5]],"4230200":[[230010000,28],[230010001,9]],"8150200":[[240030102,9],[240030103,9],[240030104,9],[240030101,6],[240030200,6],[240030100,2]],"8142100":[[230040300,28],[230040200,5],[610030550,2]],"9400622":[[103030200,4]],"9400588":[[610010200,7],[610010201,7],[610010202,7],[610010000,5],[610010002,5],[610010003,4],[610010100,4],[610010101,4],[610010102,4],[610010103,4],[610010104,4],[610010001,3],[610010005,3],[610010011,3],[610010013,3]],"3210450":[[230010001,23],[200082300,18],[230010000,8]],"9400001":[[800030000,26]],"3210207":[[220040200,33]],"9400548":[[600010200,16],[600020100,14],[600010300,11],[600010400,10]],"3400003":[[103040200,16]],"9300116":[[925100100,33]],"9300110":[[925100000,8]],"9400012":[[800020120,16]],"9300046":[[920010200,10]],"7120106":[[240070200,13],[240070201,8]],"5120502":[[251010300,12],[251010200,5]],"9400559":[[682000301,7],[682000400,6],[682000403,5],[682000303,3],[682000305,3],[682000605,3],[682000100,2],[682000601,1],[682000602,1],[682000603,1],[682000604,1]],"9420527":[[550000100,15]],"4230112":[[220030000,29],[220020000,22],[220020100,10],[220030100,6]],"9400606":[[683000120,4]],"9420532":[[551000200,19]],"9300328":[[130030002,4]],"4230126":[[101030107,15],[101030106,10],[101030105,7]],"8200005":[[270020100,20]],"9300131":[[980000301,6],[980000401,6]],"9300100":[[922020100,1]],"9300141":[[926120100,16]],"3230307":[[221023600,24],[221023500,21],[221023300,3]],"4230119":[[221030000,51],[221030100,21],[221030301,17],[221030300,8],[221030200,7]],"9400613":[[677000011,4]],"9300157":[[980010101,20],[980010201,20],[980010301,20]],"9300133":[[980000501,10],[980000601,10],[980000301,6],[980000401,6]],"9300062":[[910010000,1]],"9500347":[[970031100,1],[970031101,1],[970031102,1],[970031103,1],[970031104,1],[970031105,1],[970031106,1],[970031107,1],[970031108,1],[970031109,1],[970031110,1],[970031111,1],[970041100,1],[970041101,1],[970041102,1],[970041103,1],[970041104,1],[970041105,1],[970041106,1],[970041107,1],[970041108,1],[970041109,1],[970041110,1],[970041111,1],[970041112,1],[970041113,1],[970041114,1],[970041115,1],[970041116,1],[970041117,1]],"9420506":[[540000200,6],[540000300,6]],"4300012":[[103040420,20]],"9300172":[[930000100,50]],"2100108":[[260020100,10],[260020000,9]],"7120108":[[240070300,15],[240070301,4]],"9300099":[[923000000,5]],"9300071":[[240050103,1]],"2230111":[[101030103,21],[101030102,9]],"9300098":[[923000000,14]],"3230405":[[230010100,14],[230010000,13]],"8200001":[[270010100,17]],"100122":[[130010110,14],[130010100,13]],"9400609":[[677000011,4]],"9420530":[[550000200,13]],"9400543":[[600020500,33],[600010200,13],[600010400,9]],"9300111":[[925100000,9]],"9400558":[[682000302,4],[682000303,3],[682000300,2],[682000505,2],[682000900,2],[682000305,1]],"5120100":[[221030601,3]],"5110302":[[261020500,26],[261020400,13]],"8200007":[[270020300,17],[270020400,2]],"9300053":[[920011000,5]],"2230108":[[230030200,40],[230030100,8]],"6130207":[[250010500,25],[250010700,20],[250010600,18]],"7120102":[[240070030,1]],"9300052":[[920011000,5]],"8120102":[[240070400,6],[240070401,6]],"9300094":[[921100300,4]],"9300045":[[920010200,10]],"9400623":[[677000011,4]],"4230502":[[250010200,15],[250010300,9],[250010100,5]],"9400615":[[104040001,2],[104040002,2]],"5130108":[[211041600,25],[211041700,20],[211041500,16],[211041800,10]],"9300070":[[240050102,6]],"9420508":[[541000200,14]],"5110300":[[261020100,17]],"8220012":[[240070503,1]],"7130000":[[200010302,15],[800010100,15],[200010301,14],[200010300,9]],"9300000":[[103000804,6]],"9400580":[[610010012,3],[610010013,3],[610010001,2],[610010003,2],[610010005,2],[610020003,2],[610030520,2],[610030521,2],[610030522,2]],"9400000":[[800020000,26],[800020101,26],[800020100,6]],"9400619":[[102020300,3]],"5120505":[[250010600,12],[250010500,6],[250010700,4],[250010501,1]],"5100005":[[222010201,13],[922200000,11],[222010102,6],[222010101,5],[222010200,3],[222010100,1]],"3230303":[[221022500,21],[221022600,21],[221022400,9]],"8200004":[[270010500,14],[270010400,11]],"8140102":[[240020100,12],[240020000,11],[240020500,10],[240020501,6],[240020101,3],[240020102,3]],"9100013":[[926000000,1]],"4300015":[[103040440,19],[103040450,4]],"3230400":[[197000000,26],[221023401,24],[221021400,21],[221022400,21],[221023200,20],[221023300,15],[221020600,12],[221022700,12],[221021500,9],[221020500,6],[221022500,4],[221022600,4]],"7130104":[[251010410,15],[251010403,12],[251010402,9],[251010401,3]],"8170000":[[220070400,2]],"2230131":[[105050300,17],[105050200,12],[105050100,8],[105050000,2]],"5250002":[[300010400,9]],"100130":[[140010100,3]],"9300287":[[913010000,1]],"9400544":[[600010600,25],[600010500,19]],"3230304":[[221021500,21],[221021100,18],[221021400,9],[221022500,3]],"9300134":[[980000101,4],[980000201,4]],"4240000":[[221040201,3],[221040300,2],[221040301,2],[221040400,2]],"4230506":[[251010100,9],[251010101,5],[251010000,2],[251010102,1]],"9300343":[[914010200,16]],"4130102":[[200040001,12],[200060000,9]],"9300288":[[913010100,1]],"2100101":[[260010600,6],[260010700,3]],"9400640":[[682010203,31],[682000800,13],[682000405,4],[682000502,4],[682000603,4],[682000605,4],[682000500,1],[682000504,1],[682000602,1]],"9500339":[[970030300,1],[970030301,1],[970030302,1],[970030303,1],[970030304,1],[970030305,1],[970030306,1],[970030307,1],[970030308,1],[970030309,1],[970030310,1],[970030311,1],[970040300,1],[970040301,1],[970040302,1],[970040303,1],[970040304,1],[970040305,1],[970040306,1],[970040307,1],[970040308,1],[970040309,1],[970040310,1],[970040311,1],[970040312,1],[970040313,1],[970040314,1],[970040315,1],[970040316,1],[970040317,1]],"9001001":[[108010201,1]],"5100002":[[600020400,28],[801000110,15],[801000210,15],[211042200,9],[211042000,5],[280020000,3]],"9300115":[[925100100,33]],"9300136":[[980000501,6],[980000601,6]],"7130601":[[240010300,9],[240010100,8]],"9420533":[[550000300,17],[551000100,9]],"9420534":[[550000400,16],[551000100,6]],"9300146":[[926100001,19],[926110001,19]],"6090001":[[211010000,1],[211020000,1],[211050000,1]],"9300339":[[922241000,6]],"2100100":[[260010700,5],[260010600,3]],"3300002":[[106020402,13],[106020401,4]],"9400516":[[670000100,11],[670000200,11]],"9500337":[[970030100,1],[970030101,1],[970030102,1],[970030103,1],[970030104,1],[970030105,1],[970030106,1],[970030107,1],[970030108,1],[970030109,1],[970030110,1],[970030111,1],[970040100,1],[970040101,1],[970040102,1],[970040103,1],[970040104,1],[970040105,1],[970040106,1],[970040107,1],[970040108,1],[970040109,1],[970040110,1],[970040111,1],[970040112,1],[970040113,1],[970040114,1],[970040115,1],[970040116,1],[970040117,1]],"9420538":[[551020000,10]],"9400004":[[800020200,12],[800020110,7]],"6400000":[[211040300,5],[211040400,4],[211040700,4]],"8140500":[[800020400,21],[801040004,14],[211042200,13]],"9300001":[[103000800,22]],"9500346":[[970031000,1],[970031001,1],[970031002,1],[970031003,1],[970031004,1],[970031005,1],[970031006,1],[970031007,1],[970031008,1],[970031009,1],[970031010,1],[970031011,1],[970041000,1],[970041001,1],[970041002,1],[970041003,1],[970041004,1],[970041005,1],[970041006,1],[970041007,1],[970041008,1],[970041009,1],[970041010,1],[970041011,1],[970041012,1],[970041013,1],[970041014,1],[970041015,1],[970041016,1],[970041017,1]],"3210208":[[222020300,15],[222020100,14],[222020200,13]],"4230110":[[221020701,14],[221020400,5],[221020700,4]],"9300127":[[980000101,6],[980000201,6]],"9400747":[[674030300,1]],"9300063":[[910010000,2]],"9400003":[[800020200,13],[800020300,13]],"7120109":[[240070301,14],[240070302,14]],"9400560":[[682000602,3],[682000301,1],[682000403,1],[682000500,1]],"4230117":[[221040200,15],[221040300,8],[221040100,7]],"9300122":[[925100400,10]],"8220001":[[211040101,1]],"9400617":[[100030000,3],[104040001,2]],"8120104":[[240070501,11],[240070500,4]],"9300022":[[990000500,4]],"9500358":[[970032200,1],[970032201,1],[970032202,1],[970032203,1],[970032204,1],[970032205,1],[970032206,1],[970032207,1],[970032208,1],[970032209,1],[970032210,1],[970032211,1],[970042200,1],[970042201,1],[970042202,1],[970042203,1],[970042204,1],[970042205,1],[970042206,1],[970042207,1],[970042208,1],[970042209,1],[970042210,1],[970042211,1],[970042212,1],[970042213,1],[970042214,1],[970042215,1],[970042216,1],[970042217,1]],"4230118":[[221040300,22],[221040400,17],[221040301,7]],"7130002":[[240011000,15],[240010901,4]],"3230308":[[221020500,24],[221020600,18],[221021100,12]],"7120104":[[240070101,20]],"6130101":[[100000005,1]],"7130103":[[101030109,14],[101030108,5]],"8220010":[[240070303,1]],"5150001":[[101030110,20],[101030111,12],[101030112,6],[101030106,2],[101030107,2]],"9300073":[[240050104,1]],"8110300":[[261010102,2]],"8150100":[[230040400,19],[610030550,8]],"9300294":[[913020300,1]],"9500343":[[970030700,1],[970030701,1],[970030702,1],[970030703,1],[970030704,1],[970030705,1],[970030706,1],[970030707,1],[970030708,1],[970030709,1],[970030710,1],[970030711,1],[970040700,1],[970040701,1],[970040702,1],[970040703,1],[970040704,1],[970040705,1],[970040706,1],[970040707,1],[970040708,1],[970040709,1],[970040710,1],[970040711,1],[970040712,1],[970040713,1],[970040714,1],[970040715,1],[970040716,1],[970040717,1]],"9400616":[[104040002,2],[104040001,1]],"3230305":[[220010000,16],[220010100,8],[220010200,8],[220010800,5],[220010700,4]],"9300148":[[926100200,23],[926110200,23]],"100133":[[140020200,18]],"4230121":[[221030500,21],[221030600,19],[221030501,16],[221030601,15],[221030400,13],[221030300,3]],"8150201":[[240030104,13],[240030102,8],[240030101,7],[240030100,2],[240030300,1]],"9400656":[[100030000,4]],"4230113":[[220050100,33],[220040200,24]],"9300048":[[920010800,9]],"4250000":[[300010000,8],[300030000,3],[300010100,2]],"4130104":[[200060000,14]],"8140103":[[240020400,22],[240020300,9],[240020501,8],[240020500,7],[240020401,6],[240020402,6]],"2230200":[[230020200,28],[230020101,12],[230020300,8]],"8200006":[[270020200,20]],"4110301":[[261020700,18]],"9500341":[[970030500,1],[970030501,1],[970030502,1],[970030503,1],[970030504,1],[970030505,1],[970030506,1],[970030507,1],[970030508,1],[970030509,1],[970030510,1],[970030511,1],[970040500,1],[970040501,1],[970040502,1],[970040503,1],[970040504,1],[970040505,1],[970040506,1],[970040507,1],[970040508,1],[970040509,1],[970040510,1],[970040511,1],[970040512,1],[970040513,1],[970040514,1],[970040515,1],[970040516,1],[970040517,1]],"8140700":[[240030000,12],[240030100,8]],"9400638":[[682010201,31],[682000800,21],[682000600,8],[682000500,6],[682000300,5],[682000400,5],[682000900,5],[682000504,1]],"7120103":[[240070100,18]],"9400002":[[800010001,38],[800030000,15]],"9420535":[[551030001,24],[551010000,13]],"9500344":[[970030800,1],[970030801,1],[970030802,1],[970030803,1],[970030804,1],[970030805,1],[970030806,1],[970030807,1],[970030808,1],[970030809,1],[970030810,1],[970030811,1],[970040800,1],[970040801,1],[970040802,1],[970040803,1],[970040804,1],[970040805,1],[970040806,1],[970040807,1],[970040808,1],[970040809,1],[970040810,1],[970040811,1],[970040812,1],[970040813,1],[970040814,1],[970040815,1],[970040816,1],[970040817,1]],"4230600":[[260020401,6],[260020400,3]],"9400603":[[683000110,16]],"9300068":[[240050101,6]],"3110101":[[220010300,28],[220010800,24],[220010900,24],[220010400,19],[220010100,14],[220010200,14],[220010600,13],[220010700,12],[197010000,11],[220010500,4]],"9300008":[[922010401,1],[922010402,1],[922010403,1]],"3300001":[[106020400,14],[106020300,10],[106020401,6],[106020100,2],[106020200,2]],"9300060":[[910010200,6]],"8140701":[[240030100,13],[240030103,8],[240030000,5]],"9300058":[[910010200,12]],"5120506":[[250010502,20],[250010501,19],[250010503,12]],"9420505":[[541000100,21]],"9300169":[[922010700,1]],"9400102":[[801020000,7],[801030000,3],[801040100,1]],"8140600":[[230040000,16],[230040100,10]],"6230601":[[105090311,21],[105090320,18],[105090312,16]],"6300000":[[211040100,9],[211040101,8],[211040200,8]],"2110301":[[260020700,10],[260020600,8],[260020620,4]],"7140000":[[220060200,25]],"9420510":[[541010010,29],[541000300,8]],"9400101":[[801010000,14],[801020000,7],[801030000,3],[801040100,1]],"6110301":[[261020401,14],[261010101,5],[261010103,4]],"9300082":[[910010000,2]],"9500359":[[970032300,1],[970032301,1],[970032302,1],[970032303,1],[970032304,1],[970032305,1],[970032306,1],[970032307,1],[970032308,1],[970032309,1],[970032310,1],[970032311,1],[970042300,1],[970042301,1],[970042302,1],[970042303,1],[970042304,1],[970042305,1],[970042306,1],[970042307,1],[970042308,1],[970042309,1],[970042310,1],[970042311,1],[970042312,1],[970042313,1],[970042314,1],[970042315,1],[970042316,1],[970042317,1]],"9500353":[[970031700,1],[970031701,1],[970031702,1],[970031703,1],[970031704,1],[970031705,1],[970031706,1],[970031707,1],[970031708,1],[970031709,1],[970031710,1],[970031711,1],[970041700,1],[970041701,1],[970041702,1],[970041703,1],[970041704,1],[970041705,1],[970041706,1],[970041707,1],[970041708,1],[970041709,1],[970041710,1],[970041711,1],[970041712,1],[970041713,1],[970041714,1],[970041715,1],[970041716,1],[970041717,1]],"100131":[[140020000,21]],"2100104":[[260010200,11],[260010201,10]],"4230500":[[250010000,17],[250010100,4]],"9300067":[[240050101,1]],"9500203":[[230000003,1]],"8150300":[[240040310,9],[240040000,7],[240040100,7],[240040400,5],[240040401,3]],"9400579":[[610030013,7],[610020003,6],[610020013,6],[610020005,5],[610020015,4],[610020014,3],[610010003,1]],"9409001":[[2,3]],"9500354":[[970031800,1],[970031801,1],[970031802,1],[970031803,1],[970031804,1],[970031805,1],[970031806,1],[970031807,1],[970031808,1],[970031809,1],[970031810,1],[970031811,1],[970041800,1],[970041801,1],[970041802,1],[970041803,1],[970041804,1],[970041805,1],[970041806,1],[970041807,1],[970041808,1],[970041809,1],[970041810,1],[970041811,1],[970041812,1],[970041813,1],[970041814,1],[970041815,1],[970041816,1],[970041817,1]],"9420539":[[551030000,26]],"9400605":[[683000120,13]],"9300003":[[103000804,1]],"4230103":[[106000120,24],[106000130,15]],"8200012":[[270030500,15],[270030400,14]],"9300292":[[913020100,1]],"9400564":[[682000700,5],[682000302,1],[682000304,1],[682000402,1]],"9300114":[[925100100,31]],"4230503":[[250010300,11],[250010400,3]],"9300043":[[920010603,10]],"4300006":[[103040300,24],[103040303,10],[103040301,9]],"9400621":[[103030200,4]],"8141300":[[230040200,21],[230040300,6],[610030550,4]],"4230125":[[101030105,16],[101030106,13],[101030107,4]],"9500202":[[230000003,2]],"7120101":[[240070020,1]],"9400100":[[801010000,11],[801020000,8],[801030000,4],[801040100,1]],"3110303":[[261010003,14],[261010002,7]],"9300042":[[920010602,10]],"9300088":[[910300000,6]],"8140510":[[240070060,1]],"9500342":[[970030600,1],[970030601,1],[970030602,1],[970030603,1],[970030604,1],[970030605,1],[970030606,1],[970030607,1],[970030608,1],[970030609,1],[970030610,1],[970030611,1],[970040600,1],[970040601,1],[970040602,1],[970040603,1],[970040604,1],[970040605,1],[970040606,1],[970040607,1],[970040608,1],[970040609,1],[970040610,1],[970040611,1],[970040612,1],[970040613,1],[970040614,1],[970040615,1],[970040616,1],[970040617,1]],"8190003":[[240040510,11],[240040511,8],[240040800,8]],"6130203":[[250010303,20],[250010304,14],[250010302,8]],"8180001":[[240020101,1],[240020102,1]],"9300074":[[240050104,6]],"6130103":[[211040001,16]],"9300120":[[925100400,8]],"8120106":[[240070502,6]],"9300318":[[980032100,4]],"8190005":[[240040521,5],[240040600,3]],"4230122":[[200030000,14]],"2110300":[[260020630,17],[260020500,11],[260020600,6],[260020610,5]],"9300150":[[926100401,2],[926110401,2]],"9300289":[[913010200,1]],"9400612":[[677000011,4]],"9400742":[[674030300,31]],"9500102":[[1010400,12]],"4230505":[[251010000,19],[251010100,4]],"4230124":[[230010200,18],[230010400,5]],"7090000":[[261020401,1]],"3210203":[[220030200,35],[220020200,32],[220020300,28],[220020400,25],[220030300,24],[220011000,19],[220020100,9],[220020500,8],[220030400,8]],"5120500":[[250010301,19],[250010302,11],[250010303,4]],"8190004":[[240040511,9],[240040800,9],[240040510,6],[240040600,3]],"9420531":[[551000200,18]],"9300173":[[930000200,2]],"9420503":[[540000300,21],[540000200,12]],"8140511":[[240070600,16],[240070601,10]],"9300170":[[922010700,1]],"9420529":[[550000200,15]],"8190000":[[240040520,8],[240040900,8],[240040521,7]],"9300065":[[240050100,5]],"9300072":[[240050103,6]],"9300007":[[922010300,8]],"6090003":[[222010300,1]],"9300069":[[240050102,1]],"9300085":[[910500000,5]],"9500340":[[970030400,1],[970030401,1],[970030402,1],[970030403,1],[970030404,1],[970030405,1],[970030406,1],[970030407,1],[970030408,1],[970030409,1],[970030410,1],[970030411,1],[970040400,1],[970040401,1],[970040402,1],[970040403,1],[970040404,1],[970040405,1],[970040406,1],[970040407,1],[970040408,1],[970040409,1],[970040410,1],[970040411,1],[970040412,1],[970040413,1],[970040414,1],[970040415,1],[970040416,1],[970040417,1]],"6130209":[[250010503,22],[250010504,12],[250010502,5]],"9400741":[[674030300,33]],"9300025":[[990000630,1]],"4090000":[[106000110,14],[104010001,1]],"9300171":[[922010700,1]],"9400602":[[683000100,14]],"9300272":[[913000100,17]],"9420511":[[541010040,29],[541000300,12]],"8120101":[[240070050,1]],"8140000":[[211040800,3],[211040900,3],[211041000,3]],"8140512":[[240070602,16],[240070601,8]],"9420528":[[550000100,14]],"2100106":[[260010400,16],[260010500,12],[260010300,3]],"8150101":[[230040400,15],[610030550,2]],"9400614":[[104040002,3],[104040001,2]],"5100004":[[222010300,21],[222010310,18],[222010201,12],[800020120,8]],"7120107":[[240070202,14],[240070201,8]],"6230200":[[211040400,11]],"3230103":[[221021200,7],[221021300,5]],"9300112":[[925100201,33],[925100301,33]],"9400576":[[610020002,10],[610020013,7],[610030011,7],[610020012,6],[610020005,5],[610020011,5],[610020015,5],[610010003,4],[610020014,4],[610010200,1],[610010201,1],[610010202,1]],"3210204":[[220011000,22],[220010900,12],[220010800,7],[220010300,5]],"4230504":[[250010400,14],[250010300,7]],"9400515":[[670000100,11],[670000200,10]],"9300014":[[922010404,2],[922010405,1]],"1140100":[[106000100,22],[101030101,18],[106000200,12],[106000000,10],[101030102,7]],"3000006":[[230020100,28],[230020101,28]],"8200011":[[270030300,15],[270030400,3]],"9300118":[[925100302,11],[925100202,8]],"7130003":[[240010900,18],[240010901,17]],"9300077":[[240050300,6]],"9300274":[[100010100,20],[100010000,2]],"9300006":[[922010100,10],[922010900,1]],"9420540":[[551030100,17]],"9400563":[[682000600,10],[682000400,6],[682000402,5],[682000503,3],[682000900,3],[682000404,1],[682000500,1],[682000601,1],[682000604,1]],"9400545":[[600020300,64]],"9400582":[[610030510,21],[610020006,8],[610030015,7]],"4300013":[[103040430,1],[103040460,1]],"9300326":[[910520000,1]],"8120100":[[240070040,1]],"4300011":[[103040410,19],[103040420,4]],"9300113":[[925100201,15],[925100301,15]],"3210205":[[221020200,14],[221023900,14],[221024000,11],[221023800,10],[221024100,8],[221023700,7],[221020100,5],[221024200,5],[221020300,4],[221020400,4]],"9420537":[[551020000,7]],"1140130":[[101030101,11]],"4230300":[[222010002,20],[222010001,15],[222010000,13]],"9001000":[[108010301,1]],"7130501":[[240010101,30],[240010100,8],[240010000,2]],"6230602":[[101030112,14],[101030108,9],[101030111,8],[101030110,5],[101030109,3]],"8150302":[[240040300,16],[240040200,13],[240040401,8],[240040400,7],[240040500,6]],"100134":[[140010200,13]],"9400509":[[680010000,16],[680010100,10],[670000100,6],[670000200,6]],"4110300":[[261020600,13],[261020700,9]],"9420501":[[540020000,38]],"3400002":[[103040102,21]],"9300023":[[990000500,4]],"3230104":[[230020100,12],[230020000,8]],"8200003":[[270010300,17],[270010400,3]],"3400000":[[103040100,20],[103040101,13],[103040103,13]],"8180000":[[240020401,1],[240020402,1]],"4230123":[[230010300,17],[230010400,4]],"7160000":[[220060201,21]],"3210206":[[221022700,18],[221023300,12],[221023200,9],[221023500,9],[221023600,6],[221022600,3]],"9300005":[[922010100,15]],"9400618":[[102020300,3]],"8140001":[[240010700,8],[240010800,8],[240010600,5]],"9400111":[[801040001,9],[801020000,6],[801040003,5],[801030000,4],[801040100,1]],"9300293":[[913020200,1]],"5110301":[[261020300,20],[261020301,19],[261020400,14]],"9300117":[[925100302,10],[925100202,9]],"7110301":[[261010103,19],[261010102,14]],"4300007":[[103040301,19],[103040302,9]],"8140110":[[240010500,13],[240010400,12],[240010800,5]],"9300154":[[926130101,8]],"3110301":[[260020620,10],[260020610,8]],"9400577":[[610020003,8],[610020012,7],[610030012,7],[610020005,5],[610020010,5],[610020014,4],[610010005,3]],"4230120":[[221030200,27],[221030300,17],[221030100,16],[221030401,16],[221030400,12],[221030500,11],[221030600,6],[221030601,4]],"9300081":[[910010000,2]],"9400561":[[682000800,14],[682000501,6],[682000601,1],[682000602,1],[682000603,1]],"9300316":[[980031100,4],[980033100,4]],"9400581":[[610030520,12],[610030014,7],[610030521,7],[610030522,6],[610010005,5],[610020002,5],[610020005,5],[610020010,5],[610020011,5],[610020015,3]],"8160000":[[220060400,2]],"8141100":[[220060301,26]],"4250001":[[300010200,9],[300010100,7],[300010300,2]],"2230105":[[230030001,26],[230030200,15],[230030100,12]],"9300096":[[924000001,10]],"3400001":[[103040101,18],[103040103,18],[103040102,10]],"1110130":[[100040003,14]],"9300040":[[920010300,1]],"100120":[[130010010,10],[130010000,9],[130030004,1]],"8120103":[[240070402,14],[240070401,6]],"9400574":[[610020004,11]],"9300121":[[925100400,8]],"9420512":[[541010050,23]],"6130204":[[251010400,22],[251010500,22],[251010401,4]],"9300075":[[240050105,1]],"9300087":[[910500100,11]],"9420504":[[541000100,15]],"8140703":[[240030300,10]],"9409000":[[2,3]],"9300086":[[922020100,1]],"5090000":[[103000105,1],[103000202,1]],"9300024":[[990000610,9]],"9300018":[[40000,3]],"9400620":[[101010102,4]],"3110300":[[261010001,18],[261010002,4]],"9400586":[[610020003,5],[610020002,4]],"8200008":[[270020400,17],[270020500,14]],"9300269":[[925020010,1]],"100132":[[140020100,12]],"9400655":[[100030000,4]],"9300314":[[910031000,9]],"9300076":[[240050300,15],[240050105,4]],"9500345":[[970030900,1],[970030901,1],[970030902,1],[970030903,1],[970030904,1],[970030905,1],[970030906,1],[970030907,1],[970030908,1],[970030909,1],[970030910,1],[970030911,1],[970040900,1],[970040901,1],[970040902,1],[970040903,1],[970040904,1],[970040905,1],[970040906,1],[970040907,1],[970040908,1],[970040909,1],[970040910,1],[970040911,1],[970040912,1],[970040913,1],[970040914,1],[970040915,1],[970040916,1],[970040917,1]],"9300342":[[914010100,16]],"6090000":[[211041100,1],[211041200,1],[211041300,1],[211041400,1]],"9420507":[[540020100,16]],"9500338":[[970030200,1],[970030201,1],[970030202,1],[970030203,1],[970030204,1],[970030205,1],[970030206,1],[970030207,1],[970030208,1],[970030209,1],[970030210,1],[970030211,1],[970040200,1],[970040201,1],[970040202,1],[970040203,1],[970040204,1],[970040205,1],[970040206,1],[970040207,1],[970040208,1],[970040209,1],[970040210,1],[970040211,1],[970040212,1],[970040213,1],[970040214,1],[970040215,1],[970040216,1],[970040217,1]],"9400604":[[683000110,10]],"9300020":[[990000420,14]],"2100105":[[260010301,18],[260010300,11]],"9300041":[[920010601,10]],"9400745":[[674030300,1]],"7130001":[[211042100,13],[211042000,11],[211042200,7]],"9400565":[[682000800,5]],"3110102":[[221020000,21],[221024300,17],[221024100,14],[221024400,14],[221024200,13],[221020100,8]],"4110302":[[261020200,24],[261020100,5]],"9400549":[[610010005,1],[610010010,1],[610010011,1],[610010013,1],[610010200,1],[610010201,1],[610010202,1],[682000001,1]],"4230400":[[101040003,30],[106000140,29],[106000130,15],[106000120,7]],"4230501":[[250010100,11],[250010000,9],[250010200,5]],"9500355":[[970031900,1],[970031901,1],[970031902,1],[970031903,1],[970031904,1],[970031905,1],[970031906,1],[970031907,1],[970031908,1],[970031909,1],[970031910,1],[970031911,1],[970041900,1],[970041901,1],[970041902,1],[970041903,1],[970041904,1],[970041905,1],[970041906,1],[970041907,1],[970041908,1],[970041909,1],[970041910,1],[970041911,1],[970041912,1],[970041913,1],[970041914,1],[970041915,1],[970041916,1],[970041917,1]],"8220011":[[240070403,1]],"9500351":[[970031500,1],[970031501,1],[970031502,1],[970031503,1],[970031504,1],[970031505,1],[970031506,1],[970031507,1],[970031508,1],[970031509,1],[970031510,1],[970031511,1],[970041500,1],[970041501,1],[970041502,1],[970041503,1],[970041504,1],[970041505,1],[970041506,1],[970041507,1],[970041508,1],[970041509,1],[970041510,1],[970041511,1],[970041512,1],[970041513,1],[970041514,1],[970041515,1],[970041516,1],[970041517,1]],"8140702":[[240030200,10]],"9300341":[[914010000,16]],"6110300":[[261010101,11]],"9400639":[[682010202,31],[682000800,15],[682000400,5],[682000404,5],[682000604,5],[682000504,3],[682000503,2],[682000500,1]],"9500348":[[970031200,1],[970031201,1],[970031202,1],[970031203,1],[970031204,1],[970031205,1],[970031206,1],[970031207,1],[970031208,1],[970031209,1],[970031210,1],[970031211,1],[970041200,1],[970041201,1],[970041202,1],[970041203,1],[970041204,1],[970041205,1],[970041206,1],[970041207,1],[970041208,1],[970041209,1],[970041210,1],[970041211,1],[970041212,1],[970041213,1],[970041214,1],[970041215,1],[970041216,1],[970041217,1]],"8141000":[[220060300,14]],"7130600":[[240010200,12],[240010100,10]],"8200009":[[270030100,22]],"9300126":[[925100400,9]],"8090000":[[261010102,1]],"9300019":[[990000420,1]],"9300013":[[922010506,7],[922010500,2]],"9300313":[[910031000,7]],"9500357":[[970032100,1],[970032101,1],[970032102,1],[970032103,1],[970032104,1],[970032105,1],[970032106,1],[970032107,1],[970032108,1],[970032109,1],[970032110,1],[970032111,1],[970042100,1],[970042101,1],[970042102,1],[970042103,1],[970042104,1],[970042105,1],[970042106,1],[970042107,1],[970042108,1],[970042109,1],[970042110,1],[970042111,1],[970042112,1],[970042113,1],[970042114,1],[970042115,1],[970042116,1],[970042117,1]],"8200010":[[270030200,22]],"7120105":[[240070102,24]],"6130208":[[251010401,14],[251010402,12],[251010403,6],[251010400,2]],"2230110":[[101030102,39],[101030101,10],[101030103,4]],"8120105":[[240070502,7],[240070501,5]],"9500352":[[970031600,1],[970031601,1],[970031602,1],[970031603,1],[970031604,1],[970031605,1],[970031606,1],[970031607,1],[970031608,1],[970031609,1],[970031610,1],[970031611,1],[970041600,1],[970041601,1],[970041602,1],[970041603,1],[970041604,1],[970041605,1],[970041606,1],[970041607,1],[970041608,1],[970041609,1],[970041610,1],[970041611,1],[970041612,1],[970041613,1],[970041614,1],[970041615,1],[970041616,1],[970041617,1]],"9300147":[[926100100,15],[926110100,15]],"3400007":[[103040202,16],[103040203,14]],"8150301":[[240040210,12],[240040100,6],[240040401,6],[240040400,5],[240040000,2]],"5100003":[[222010101,17],[222010100,14],[222010102,12],[222010001,10],[222010200,10],[222010002,2]],"9300047":[[920010200,10]],"2100102":[[260010000,14],[260010001,7]],"4230109":[[221020701,12],[221020400,6],[221020300,5],[221020700,5],[221020800,5],[221020900,4]],"5120000":[[200080000,31],[200070000,26]],"9300271":[[913000000,18]],"9400103":[[801040001,13],[801040002,10],[801040003,5],[801040100,1]],"9300097":[[923000000,9]],"100121":[[130010020,13],[130010000,6],[130030003,5],[130030004,3]],"4230116":[[221040201,18],[221040000,17],[221040100,10],[221040200,3]],"5150000":[[105040306,21],[106010106,14],[106010105,6],[105040320,4]],"8140101":[[240020200,14],[240020100,12],[240020300,9],[240020501,8],[240020101,3],[240020102,3]],"9300066":[[240050100,1]],"9001004":[[108010501,1]],"9300050":[[920010100,4]],"4230111":[[220020500,30],[220030400,28],[220030100,24],[220020100,11],[220020400,10],[220020600,10],[220030300,7]],"3110302":[[261010002,18],[261010003,8],[261010001,7]],"9300027":[[990000640,20]],"9400551":[[105090300,1]],"9420509":[[541010000,26],[541000200,12]],"9400556":[[682000500,10],[682000100,8],[682000300,5],[682000600,5],[682000900,4]],"9300108":[[925100000,4]],"9300290":[[913010300,1]],"9300291":[[913020000,1]],"9300312":[[910032100,13]],"9300059":[[910010200,18]],"9400547":[[600010300,41],[600010100,16]],"9300092":[[910500200,7]],"9420500":[[540000100,17],[540000200,12]],"3400005":[[103040201,16]],"6300005":[[105070002,1]],"9400204":[[801000110,19],[801000210,19]],"9400011":[[800020110,12]],"9400546":[[600010400,25]],"8200000":[[270010100,4],[270010200,4],[270010300,4],[270010400,4],[270010500,4],[270020100,3],[270020200,3],[270020300,3],[270020400,3],[270020500,3],[270030100,2],[270030200,2],[270030300,2],[270030400,1]],"9001003":[[108010401,1]],"2230106":[[230030001,27],[230030000,20]],"9300064":[[910010000,2]],"9500360":[[970032400,1],[970032401,1],[970032402,1],[970032403,1],[970032404,1],[970032405,1],[970032406,1],[970032407,1],[970032408,1],[970032409,1],[970032410,1],[970032411,1],[970042400,1],[970042401,1],[970042402,1],[970042403,1],[970042404,1],[970042405,1],[970042406,1],[970042407,1],[970042408,1],[970042409,1],[970042410,1],[970042411,1],[970042412,1],[970042413,1],[970042414,1],[970042415,1],[970042416,1],[970042417,1]],"3300000":[[106020100,16],[106020200,10],[106020300,3]],"4130103":[[221020701,2]],"2100103":[[260010100,14],[260010200,9],[260010000,5]],"2230109":[[230020300,32],[230020200,12]],"9400013":[[800020130,16]],"8200002":[[270010200,19]],"100123":[[130010120,15],[130010100,11],[130010200,3]],"3230302":[[221021700,16],[221021300,14],[221021800,13],[221021900,11],[221020800,9],[221020900,8],[221022000,8],[221021200,4]],"7120100":[[240070010,1]],"3100101":[[260020400,7],[260020300,6],[260020200,3]],"9300084":[[922020000,6]],"7130500":[[240010000,11],[240010101,6],[240010100,1]],"9420536":[[551030001,24],[551010000,16]],"6230600":[[105090310,21],[105090311,21],[105090312,7]],"9500349":[[970031300,1],[970031301,1],[970031302,1],[970031303,1],[970031304,1],[970031305,1],[970031306,1],[970031307,1],[970031308,1],[970031309,1],[970031310,1],[970031311,1],[970041300,1],[970041301,1],[970041302,1],[970041303,1],[970041304,1],[970041305,1],[970041306,1],[970041307,1],[970041308,1],[970041309,1],[970041310,1],[970041311,1],[970041312,1],[970041313,1],[970041314,1],[970041315,1],[970041316,1],[970041317,1]],"9500204":[[230000003,1]],"9300051":[[920011000,9]],"9400538":[[600010100,23],[600010200,22],[600010000,16]],"9400542":[[600020400,43],[600020100,12]],"9400657":[[101010102,5]],"8140002":[[240010600,8],[240010700,2]],"9500356":[[970032000,1],[970032001,1],[970032002,1],[970032003,1],[970032004,1],[970032005,1],[970032006,1],[970032007,1],[970032008,1],[970032009,1],[970032010,1],[970032011,1],[970042000,1],[970042001,1],[970042002,1],[970042003,1],[970042004,1],[970042005,1],[970042006,1],[970042007,1],[970042008,1],[970042009,1],[970042010,1],[970042011,1],[970042012,1],[970042013,1],[970042014,1],[970042015,1],[970042016,1],[970042017,1]],"4300016":[[103040450,20]],"7130004":[[240010300,9],[240010200,8]],"8140111":[[240010500,9],[240010400,4]],"3300003":[[106021001,15],[106020800,13],[106020700,12],[106021000,8],[106021100,4]],"9500201":[[230000003,1]]};

// Monster map data (hand-curated / legacy): meowdb_id -> [{name, mapId, count}]
// Source: legends.ml location tabs (confirmed fetches) + meowdb spawn data
// NOTE: for ids present in REAL_SPAWNS above, that Map.wz-verified data takes
// precedence in the UI — this curated list is the fallback for unverified monsters.
const MONSTER_MAPS = {
  2:  [{name:"Maple Island: Snail's Road", mapId:1000000, count:30},{name:"Maple Island: West Rocky Road", mapId:1000001, count:20},{name:"Victoria Road: Mushroom Town", mapId:100000000, count:15}],
  3:  [{name:"Maple Island: Snail's Road", mapId:1000000, count:25},{name:"Maple Island: East Rocky Road", mapId:1000002, count:18},{name:"Victoria Road: Mushroom Town", mapId:100000000, count:12}],
  7:  [{name:"Dungeon: Deep Forest", mapId:105030000, count:12},{name:"Kerning Subway: Forgotten Tunnel 1", mapId:103000900, count:10},{name:"Victoria Road: Forest South of Ellinia", mapId:100040000, count:8}],
  8:  [{name:"Victoria Road: Henesys Pig Farm", mapId:100020000, count:20},{name:"Victoria Road: Pigs' Road", mapId:100020100, count:18},{name:"Victoria Road: Pigmy Road", mapId:100020200, count:12}],
  9:  [{name:"Victoria Road: Henesys: Mushroom Garden", mapId:100020010, count:15},{name:"Victoria Road: Mushroom Town", mapId:100000000, count:12}],
  10: [{name:"Victoria Road: Henesys Pig Farm", mapId:100020000, count:15},{name:"Victoria Road: Pigs' Road", mapId:100020100, count:12},{name:"Victoria Road: Pigmy Road", mapId:100020200, count:10}],
  11: [{name:"East Rocky Mountain II", mapId:101030401, count:28},{name:"Dry Rocky Mountain", mapId:192000000, count:17},{name:"East Rocky Mountain III", mapId:101030402, count:14},{name:"Deep Valley III", mapId:106000200, count:10},{name:"Perion Dungeon Entrance", mapId:106000300, count:10},{name:"West Rocky Mountain II", mapId:102020100, count:10}],
  12: [{name:"Nautilus: The Deck", mapId:120000100, count:15},{name:"Florina Beach", mapId:110000000, count:12},{name:"Florina Beach: The Cave", mapId:110000010, count:10},{name:"Florina Beach: Seaweed Manor", mapId:110000001, count:8},{name:"Nautilus: Engine Room", mapId:120000101, count:6}],
  13: [{name:"Dungeon: Deep Forest", mapId:105030000, count:8},{name:"Dungeon: Swampy Land", mapId:105040000, count:12},{name:"Ellinia: Ant Tunnel I", mapId:105070000, count:15},{name:"Ellinia: Ant Tunnel II", mapId:105070100, count:12},{name:"Forest South of Ellinia", mapId:100040000, count:10}],
  14: [{name:"Florina Beach", mapId:110000000, count:20},{name:"Florina Beach: The Cave", mapId:110000010, count:15}],
  15: [{name:"East Rocky Mountain III", mapId:101030402, count:26},{name:"East Rocky Mountain IV", mapId:101030403, count:20},{name:"West Domain of Perion", mapId:102030000, count:18},{name:"Forest North of Ellinia", mapId:101020000, count:13},{name:"Deep Valley III", mapId:106000200, count:12},{name:"Deep Valley II", mapId:106000100, count:11},{name:"Over the Wall", mapId:101040002, count:11},{name:"East Domain of Perion", mapId:101030000, count:8}],
  16: [{name:"Dungeon: Ant Tunnel I", mapId:105070000, count:15},{name:"Dungeon: Ant Tunnel II", mapId:105070100, count:12},{name:"Sleepywood: Ant Tunnel Park", mapId:105060001, count:10}],
  17: [{name:"Kerning Subway: Transfer Area", mapId:103000102, count:38},{name:"Dungeon: Dangerous Steam", mapId:105060000, count:38},{name:"Dungeon: Dark Cave", mapId:105050400, count:35},{name:"Kerning Subway: Line 1 Area 2", mapId:103000103, count:21},{name:"Kerning Subway: Line 1 Area 3", mapId:103000104, count:18}],
  18: [{name:"Kerning Subway: Transfer Area", mapId:103000102, count:20},{name:"Dungeon: Dangerous Steam", mapId:105060000, count:15},{name:"Dungeon: Dark Cave", mapId:105050400, count:12},{name:"Kerning Subway: Line 2 Area 1", mapId:103000200, count:10},{name:"Swampy Land in Deep Forest", mapId:105040000, count:8}],
  19: [{name:"Dungeon: Ant Tunnel I", mapId:105070000, count:18},{name:"Dungeon: Ant Tunnel II", mapId:105070100, count:15},{name:"Dungeon: Ant Tunnel Park", mapId:105060001, count:10},{name:"Sleepywood: Swampy Area", mapId:105040300, count:12},{name:"West Rocky Mountain III", mapId:102020200, count:8}],
  20: [{name:"East Rocky Mountain IV", mapId:101030403, count:20},{name:"West Domain of Perion", mapId:102030000, count:15},{name:"Deep Valley I", mapId:106000000, count:12},{name:"Perion Dungeon", mapId:106000100, count:10}],
  21: [{name:"Sleepywood: Dungeon", mapId:105090200, count:20},{name:"Sleepywood: Dungeon Deeper", mapId:105090300, count:15},{name:"Ant Tunnel III", mapId:105070200, count:12},{name:"Ant Tunnel IV", mapId:105070300, count:10}],
  22: [{name:"Land of Wild Boar I", mapId:101030001, count:20},{name:"Land of Wild Boar II", mapId:101030002, count:18},{name:"East Rocky Mountain V", mapId:101030404, count:12}],
  23: [{name:"Forest of Evil Eye I", mapId:100030000, count:15},{name:"Forest of Evil Eye II", mapId:100030100, count:12},{name:"Forest South of Ellinia", mapId:100040000, count:10}],
  29: [{name:"Dungeon: Swampy Land", mapId:105040000, count:20},{name:"Dungeon: Swampy Land II", mapId:105040100, count:15}],
  30: [{name:"Perion: Fire Boar Land I", mapId:101030100, count:20},{name:"Perion: Fire Boar Land II", mapId:101030200, count:18},{name:"Perion: Fire Boar Land III", mapId:101030300, count:15}],
  32: [{name:"Kerning City Sewer", mapId:103000000, count:15},{name:"Kerning City: Alley", mapId:103010000, count:10},{name:"Abandoned Mine Shaft", mapId:103020000, count:8},{name:"Forgotten Tunnel 1", mapId:103000900, count:6}],
  33: [{name:"Sleepywood: Dungeon Deeper", mapId:105090300, count:15},{name:"Sanctuary Entrance", mapId:105090400, count:12},{name:"Ant Tunnel IV", mapId:105070300, count:10}],
  34: [{name:"Sleepywood: Dungeon", mapId:105090200, count:15},{name:"Sleepywood: Dungeon Deeper", mapId:105090300, count:12},{name:"Ant Tunnel IV", mapId:105070300, count:10}],
  38: [{name:"Ludibrium: Sky Terrace I", mapId:220060000, count:18},{name:"Ludibrium: Sky Terrace II", mapId:220060100, count:15},{name:"Eos Tower 76F-90F", mapId:221020000, count:12},{name:"Helios Tower 1F-20F", mapId:222000000, count:10}],
  43: [{name:"Kerning City Sewer System", mapId:103000000, count:15},{name:"Kerning City: Construction Site", mapId:102040000, count:12},{name:"Abandoned Mine Shaft", mapId:103020000, count:10}],
  1001:[{name:"Orbis: Cloud Park I", mapId:200010000, count:20},{name:"Orbis: Cloud Park II", mapId:200010100, count:18},{name:"Orbis: Cloud Park III", mapId:200010200, count:15},{name:"Orbis: Cloud Park IV", mapId:200010300, count:12},{name:"Orbis Tower 1F-5F", mapId:200080000, count:8}],
  1025:[{name:"Eos Tower 21F-40F", mapId:221020200, count:20},{name:"Eos Tower 41F-60F", mapId:221020300, count:18},{name:"Eos Tower 61F-75F", mapId:221020400, count:15}],
  1034:[{name:"Eos Tower 1F-20F", mapId:221020100, count:20},{name:"Eos Tower 21F-40F", mapId:221020200, count:18}],
  1047:[{name:"Eos Tower 1F-20F", mapId:221020100, count:20},{name:"Helios Tower 1F-20F", mapId:222000000, count:15}],
  700004:[{name:"Thicket Around the Beach III", mapId:104000400, count:1}],
  700000:[{name:"Henesys: Mushroom Farm", mapId:100020010, count:1}],
  700002:[{name:"Sleepywood: Sanctuary", mapId:105090900, count:1}],
  700003:[{name:"Sleepywood: Boss Zone", mapId:105090900, count:1}],
  800003:[{name:"Kerning Subway: Line 1 Final Stop", mapId:103000200, count:1}],
};
const effColor = r => r < 4 ? "#22c55e" : r < 5 ? "#84cc16" : r < 6 ? "#eab308" : "#ef4444";
const badge = (label, val, color) => (
  <span style={{ background:color, color:"#fff", borderRadius:4, padding:"1px 7px", fontSize:11, fontWeight:700, marginRight:4 }}>
    {label}: {val}
  </span>
);

// -- Variable-height virtualized list -----------------------------------------
// Renders only the items currently near the viewport (plus overscan), instead of
// mounting the entire filtered list at once. This matters a lot here because each
// monster card can include several real spawn-map thumbnail images -- with 1000+
// monsters, mounting everything at once would mean loading potentially thousands
// of images into the DOM simultaneously.
//
// Card heights vary a lot (a curated monster with heal analysis and 10 spawn map
// thumbnails vs. a plain auto-generated row), so this uses *measured* heights
// rather than a single fixed row height: unmeasured items use `estimatedItemHeight`
// as a placeholder, and get corrected to their real height after they first mount,
// which nudges the layout to the right total height without a full remeasure pass.
function VirtualList({ items, renderItem, estimatedItemHeight = 190, overscan = 6 }) {
  const [scrollY, setScrollY] = useState(typeof window !== "undefined" ? window.scrollY : 0);
  const [viewportH, setViewportH] = useState(typeof window !== "undefined" ? window.innerHeight : 800);
  const [containerTop, setContainerTop] = useState(0);
  const heightsRef = useRef(new Map()); // index -> measured height (persists across renders)
  const [, forceRerender] = useState(0);
  const containerRef = useRef(null);

  useEffect(() => {
    const onScroll = () => setScrollY(window.scrollY);
    const onResize = () => setViewportH(window.innerHeight);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  useEffect(() => {
    if (containerRef.current) {
      setContainerTop(containerRef.current.getBoundingClientRect().top + window.scrollY);
    }
  }, [items.length]);

  // Reset measured heights when the underlying item list changes (new filter/sort),
  // since indices no longer correspond to the same items.
  useEffect(() => {
    heightsRef.current.clear();
    forceRerender(n => n + 1);
  }, [items]);

  const getHeight = (i) => heightsRef.current.get(i) ?? estimatedItemHeight;

  // Prefix-sum offsets. O(n) per render is fine at this scale (a few thousand items,
  // recomputed only on scroll/resize/measurement, not on every keystroke).
  const offsets = [];
  let acc = 0;
  for (let i = 0; i < items.length; i++) {
    offsets.push(acc);
    acc += getHeight(i);
  }
  const totalHeight = acc;

  const viewTop = Math.max(0, scrollY - containerTop);
  const viewBottom = viewTop + viewportH;

  // binary search for first index whose offset+height >= viewTop
  let lo = 0, hi = items.length - 1, startIndex = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (offsets[mid] + getHeight(mid) < viewTop) { lo = mid + 1; } else { startIndex = mid; hi = mid - 1; }
  }
  let endIndex = startIndex;
  while (endIndex < items.length && offsets[endIndex] < viewBottom) endIndex++;

  startIndex = Math.max(0, startIndex - overscan);
  endIndex = Math.min(items.length, endIndex + overscan);

  const visible = items.slice(startIndex, endIndex);

  return (
    <div ref={containerRef} style={{ position: "relative", height: totalHeight }}>
      {visible.map((item, vi) => {
        const i = startIndex + vi;
        return (
          <MeasuredRow key={item.id} index={i} top={offsets[i]}
            onMeasure={(h) => {
              const prev = heightsRef.current.get(i);
              if (prev === undefined || Math.abs(prev - h) > 2) {
                heightsRef.current.set(i, h);
                forceRerender(n => n + 1);
              }
            }}>
            {renderItem(item, i)}
          </MeasuredRow>
        );
      })}
    </div>
  );
}

function MeasuredRow({ index, top, onMeasure, children }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) {
      const h = ref.current.getBoundingClientRect().height;
      if (h > 0) onMeasure(h);
    }
  });
  return (
    <div ref={ref} style={{ position: "absolute", top, left: 0, right: 0, paddingBottom: 8 }}>
      {children}
    </div>
  );
}


// Small labeled row for grouping filter chips by category (Level Range, Elemental
// Weakness, Efficiency, Casts, Type).
function FilterRow({ label, hint, children }) {
  return (
    <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
      <span style={{ fontSize:10, color:"#6b7280", letterSpacing:1, minWidth:110 }} title={hint}>
        {label.toUpperCase()}:
      </span>
      <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
        {children}
      </div>
    </div>
  );
}

function MonsterCard({ m, i, selected, setSelected, setWorldMapMapId, CHAR, dmg, healLvl, healTargets, mpEaterLvl, sessionMins, potionKey }) {
  return (
            <div key={m.id} onClick={()=>setSelected(selected===m.id?null:m.id)}
              style={{ background:"#161b22", border:`1px solid ${selected===m.id?"#7c3aed":i===0&&!selected?"#7c3aed44":"#21262d"}`, borderRadius:8, padding:"10px 14px", cursor:"pointer", transition:"border-color 0.15s" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:10 }}>
                <img src={mobImg(m.id)} alt=""
                  style={{ width:36, height:36, objectFit:"contain", imageRendering:"pixelated", background:"#0d1117", border:"1px solid #21262d", borderRadius:4, flexShrink:0 }}
                  onError={e=>{
                    if (!e.target.dataset.triedFallback) {
                      e.target.dataset.triedFallback = "1";
                      const wzid = mobWzId(m);
                      if (wzid) { e.target.src = mobImgFallback(wzid); }
                      else { e.target.style.display = "none"; }
                    } else {
                      e.target.style.display = "none";
                    }
                  }} />
                <div style={{ flex:1, minWidth:0 }}>
                  <span style={{ fontSize:14, fontWeight:700, color:"#e2e8f0" }}>{m.name}</span>
                  {m.boss && <span style={{ marginLeft:8, background:"#7f1d1d", color:"#fca5a5", fontSize:10, padding:"1px 6px", borderRadius:3, fontWeight:700 }}>BOSS</span>}
                  {m.undead && <span style={{ marginLeft:6, background:"#14532d", color:"#86efac", fontSize:10, padding:"1px 6px", borderRadius:3, fontWeight:700 }}>+ UNDEAD</span>}
                  {STAT_VERIFIED_IDS.has(m.id) && <span style={{ marginLeft:6, background:"#1e3a5f", color:"#7dd3fc", fontSize:10, padding:"1px 6px", borderRadius:3, fontWeight:700 }} title="HP/EXP/ATK/DEF individually spot-checked against MapleLegends' real values via legends.ml + Cosmic v83 crosswalk">[OK] STATS VERIFIED</span>}
                  {m.auto && <span style={{ marginLeft:6, background:"#3f2d0d", color:"#fbbf24", fontSize:10, padding:"1px 6px", borderRadius:3, fontWeight:700 }} title="Sourced directly from the Cosmic v83 dump (same source spot-checked accurate for the STATS VERIFIED set), but this specific entry was not individually cross-checked against legends.ml">NORMAL</span>}
                  <div style={{ fontSize:11, color:"#6b7280" }}>Lv{m.level} x {m.location}</div>
                </div>
                <div style={{ textAlign:"right", flexShrink:0 }}>
                  <span style={{ fontSize:20, fontWeight:700, color:effColor(m.ratio) }}>{m.ratio.toFixed(2)}</span>
                  <div style={{ fontSize:9, color:"#4b5563" }}>EFF RATIO</div>
                </div>
              </div>

              <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:"4px 12px", fontSize:11, marginTop:8 }}>
                <div><span style={{color:"#6b7280"}}>HP </span><span style={{color:"#f87171"}}>{m.hp.toLocaleString()}</span></div>
                <div><span style={{color:"#6b7280"}}>M.DEF </span><span style={{color:m.mDef>0?"#f97316":"#6b7280"}}>{m.mDef}</span></div>
                <div><span style={{color:"#6b7280"}}>EXP </span><span style={{color:"#4ade80"}}>{m.exp2x}</span><span style={{color:"#374151"}}> (2x)</span></div>
                <div><span style={{color:"#6b7280"}}>Meso </span><span style={{color:"#fcd34d"}}>~{Math.round(m.wAtk*0.45)}-{Math.round(m.wAtk*0.7)}</span></div>
                <div><span style={{color:"#6b7280"}}>W.ATK </span><span>{m.wAtk}</span></div>
                <div><span style={{color:"#6b7280"}}>Avoid </span><span>{m.avoid}</span></div>
                <div><span style={{color:"#6b7280"}}>ACC req </span><span>{m.acc}</span></div>
                <div><span style={{color:"#6b7280"}}>Eff.HP </span><span style={{color:"#fbbf24"}}>{m.effHP}</span></div>
              </div>

              {/* Combat */}
              <div style={{ marginTop:8, padding:"6px 10px", background:"#0d1117", borderRadius:4, borderLeft:`3px solid ${m.hits===1?"#22c55e":m.hits===2?"#eab308":"#ef4444"}`, fontSize:11, display:"flex", gap:14, flexWrap:"wrap" }}>
                <span><span style={{color:"#6b7280"}}>CASTS: </span><span style={{color:m.hits===1?"#22c55e":m.hits===2?"#eab308":"#ef4444", fontWeight:700}}>{m.hits}{m.hits===1?" [OK] ONE-SHOT":""}</span></span>
                <span><span style={{color:"#6b7280"}}>YOUR DMG: </span>{(dmg.min*MC_HITS_PER_CAST).toFixed(0)}-{(dmg.max*MC_HITS_PER_CAST).toFixed(0)}/cast ({dmg.min.toFixed(0)}-{dmg.max.toFixed(0)}/hit x2) vs {m.effHP}</span>
                <span><span style={{color:"#6b7280"}}>MP/KILL: </span><span style={{color:"#0ea5e9"}}>{m.hits*20}</span>
                  {mpEaterLvl > 0 && m.mp > 0 && (
                    <span style={{color:"#60a5fa"}}> (net ~{(m.mcNetMp * m.hits).toFixed(1)} w/MPE {(m.mcAnyProc*100).toFixed(0)}% proc)</span>
                  )}
                </span>
                {m.hits > 1 && m.oneshotLvl && (
                  <span><span style={{color:"#6b7280"}}>ONE-SHOT @ </span><span style={{color:"#a78bfa"}}>Lv{m.oneshotLvl}</span> <span style={{color:"#374151"}}>({m.oneshotLvl-CHAR.level} lvls)</span></span>
                )}
              </div>

              {/* Elements */}
              {(m.weak!=="-"||m.strong!=="-"||m.immune!=="-") && (
                <div style={{ marginTop:6, fontSize:11, display:"flex", gap:12 }}>
                  {m.weak!=="-"&&<span style={{color:"#4ade80"}}>[L] Weak: {m.weak}</span>}
                  {m.strong!=="-"&&<span style={{color:"#f87171"}}>[S] Strong: {m.strong}</span>}
                  {m.immune!=="-"&&<span style={{color:"#9ca3af"}}>[I] Immune: {m.immune}</span>}
                </div>
              )}

              {/* Heal combat (undead only) */}
              {m.undead && healLvl > 0 && (
                <div style={{ marginTop:6, padding:"6px 10px", background:"#0a1f0a", borderRadius:4, borderLeft:"3px solid #86efac", fontSize:11, display:"flex", gap:14, flexWrap:"wrap" }}>
                  <span style={{ color:"#86efac", fontWeight:700 }}>+ HEAL</span>
                  <span><span style={{color:"#6b7280"}}>CASTS TO KILL: </span>
                    <span style={{color: m.healCasts===1?"#22c55e":m.healCasts<=3?"#84cc16":"#eab308", fontWeight:700}}>
                      {m.healCasts ?? "--"}
                    </span>
                  </span>
                  <span><span style={{color:"#6b7280"}}>HEAL DMG: </span>{m.healDmgMin?.toFixed(0)}-{m.healDmgMax?.toFixed(0)}</span>
                  <span><span style={{color:"#6b7280"}}>MP/CAST: </span><span style={{color:"#0ea5e9"}}>{m.healMpCost}</span>
                    {mpEaterLvl > 0 && m.mp > 0 && (
                      <span style={{color:"#60a5fa"}}> (net ~{m.healNetMp?.toFixed(1)} w/MPE, {(m.healAnyProc*100).toFixed(0)}% proc chance)</span>
                    )}
                  </span>
                  <span><span style={{color:"#6b7280"}}>EFF RATIO (x{healTargets} targets): </span>
                    <span style={{color:effColor(m.healRatio ?? 99)}}>{m.healRatio?.toFixed(2)}</span>
                    {m.healRatio && m.healRatio < m.ratio && <span style={{color:"#86efac"}}> ^ better than Magic Claw</span>}
                  </span>
                </div>
              )}
              {m.undead && healLvl === 0 && (
                <div style={{ marginTop:6, fontSize:10, color:"#4b5563", fontStyle:"italic" }}>
                  + Set Heal level above to see Heal combat stats
                </div>
              )}
              {/* Session profit panel */}
              <div style={{ marginTop:8, padding:"8px 10px", background:"#0d1117", borderRadius:4, border:"1px solid #21262d", fontSize:11 }}>
                <div style={{ color:"#f59e0b", fontWeight:700, marginBottom:4, letterSpacing:1 }}>
                  SESSION PROFIT ({sessionMins}min)
                </div>
                <div style={{ display:"grid", gridTemplateColumns: m.healSession ? "1fr 1fr" : "1fr", gap:"4px 16px" }}>
                  <div>
                    <div style={{ color:"#6b7280", fontSize:9, marginBottom:2, letterSpacing:1 }}>MAGIC CLAW ({MC_CAST_TIME_SEC}s/kill)</div>
                    <div style={{ display:"flex", gap:12, flexWrap:"wrap" }}>
                      <span><span style={{color:"#6b7280"}}>Kills: </span><span>{m.mcSession.kills.toLocaleString()}</span></span>
                      <span><span style={{color:"#6b7280"}}>Pots: </span><span style={{color:"#f87171"}}>{m.mcSession.potCost.toLocaleString()}</span></span>
                      <span><span style={{color:"#6b7280"}}>Income: </span><span style={{color:"#86efac"}}>{m.mcSession.income.toLocaleString()}</span></span>
                      <span><span style={{color:"#6b7280"}}>Profit: </span>
                        <span style={{color: m.mcSession.profit >= 0 ? "#22c55e" : "#ef4444", fontWeight:700}}>
                          {m.mcSession.profit >= 0 ? "+" : ""}{m.mcSession.profit.toLocaleString()}
                        </span>
                      </span>
                      <span style={{color:"#a78bfa", fontWeight:700}}>
                        +{m.mcSession.levelsGained} lvl{m.mcSession.levelsGained !== 1 ? "s" : ""}
                        {" "}{m.mcSession.leftoverPct.toFixed(2)}% into Lv{m.mcSession.finalLevel}
                      </span>
                    </div>
                  </div>
                  {m.healSession && (
                    <div>
                      <div style={{ color:"#86efac", fontSize:9, marginBottom:2, letterSpacing:1 }}>HEAL x{healTargets} ({HEAL_CAST_TIME_SEC}s/cast)</div>
                      <div style={{ display:"flex", gap:12, flexWrap:"wrap" }}>
                        <span><span style={{color:"#6b7280"}}>Kills: </span><span>{m.healSession.kills.toLocaleString()}</span></span>
                        <span><span style={{color:"#6b7280"}}>Pots: </span><span style={{color:"#f87171"}}>{m.healSession.potCost.toLocaleString()}</span></span>
                        <span><span style={{color:"#6b7280"}}>Income: </span><span style={{color:"#86efac"}}>{m.healSession.income.toLocaleString()}</span></span>
                        <span><span style={{color:"#6b7280"}}>Profit: </span>
                          <span style={{color: m.healSession.profit >= 0 ? "#22c55e" : "#ef4444", fontWeight:700}}>
                            {m.healSession.profit >= 0 ? "+" : ""}{m.healSession.profit.toLocaleString()}
                          </span>
                        </span>
                        <span style={{color:"#a78bfa", fontWeight:700}}>
                          +{m.healSession.levelsGained} lvl{m.healSession.levelsGained !== 1 ? "s" : ""}
                          {" "}{m.healSession.leftoverPct.toFixed(2)}% into Lv{m.healSession.finalLevel}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
                <div style={{ color:"#374151", fontSize:8, marginTop:4 }}>
                  ~{Math.round(INCOME_PER_KILL)} mesos/kill (drop+etc+equip EV) x {POTIONS[potionKey || "bluePotion"].label}
                </div>
              </div>

              {m.spawnMaps && (
                <div style={{ marginTop:8 }}>
                  <div style={{ fontSize:10, color:"#4b5563", marginBottom:4, letterSpacing:1 }}>
                    [M] SPAWN MAPS (click for full map)
                    {m.spawnMaps.some(s=>s.verified) && (
                      <span style={{ marginLeft:8, color:"#4ade80" }}>[OK] MAP.WZ VERIFIED</span>
                    )}
                  </div>
                  <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                    {m.spawnMaps.map(({name, mapId, count, verified}) => (
                      <div key={mapId} onClick={()=>setWorldMapMapId(mapId)}
                        title={`${name} (${count} spawns)${verified ? " - Map.wz verified" : " - curated/unverified"}${MAP_PLATFORM_DATA[mapId] ? " - " + MAP_PLATFORM_DATA[mapId].notes : ""} -- click to expand`}
                        style={{ display:"block", border:`1px solid ${verified ? "#166534" : "#30363d"}`, borderRadius:4, overflow:"hidden", cursor:"pointer", flexShrink:0, transition:"border-color 0.15s", position:"relative" }}
                        onMouseEnter={e=>e.currentTarget.style.borderColor="#7c3aed"}
                        onMouseLeave={e=>e.currentTarget.style.borderColor=verified?"#166534":"#30363d"}>
                        <img src={mapImg(mapId)} alt={name}
                          style={{ width:120, height:72, objectFit:"cover", display:"block", background:"#0d1117", imageRendering:"pixelated" }}
                          onError={e=>{
                            if (!e.target.dataset.triedFallback) {
                              e.target.dataset.triedFallback = "1";
                              e.target.src = mapImgFallback(mapId);
                            } else {
                              e.target.style.display="none";
                              e.target.nextSibling.style.display="flex";
                            }
                          }} />
                        <div style={{ display:"none", width:120, height:72, background:"#161b22", alignItems:"center", justifyContent:"center", fontSize:9, color:"#6b7280", textAlign:"center", padding:"4px" }}>
                          {verified ? "" : name}
                        </div>
                        {/* External link to legends.ml full map page */}
                        <a href={mapUrl(mapId)} target="_blank" rel="noopener noreferrer" onClick={e=>e.stopPropagation()}
                          title="Open on legends.ml"
                          style={{ position:"absolute", bottom:3, right:3, background:"#0d1117cc", color:"#9ca3af", fontSize:10, fontWeight:700, padding:"1px 5px", borderRadius:3, textDecoration:"none" }}>
                          [open]
                        </a>
                        {/* Spawn count badge */}
                        <div style={{ position:"absolute", top:3, right:3, background:verified?"#166534":"#7c3aed", color:"#fff", fontSize:9, fontWeight:700, padding:"1px 5px", borderRadius:3, letterSpacing:0.5 }}>
                          x{count}
                        </div>
                        {/* Heal coverage badge (undead maps only, hand-curated subset) */}
                        {m.undead && MAP_PLATFORM_DATA[mapId] && (
                          <div style={{ position:"absolute", top:3, left:3, background:healCoverageColor(MAP_PLATFORM_DATA[mapId].healCoverage), color:"#000", fontSize:9, fontWeight:700, padding:"1px 5px", borderRadius:3 }}>
                            {layoutIcon(MAP_PLATFORM_DATA[mapId].layout)} {MAP_PLATFORM_DATA[mapId].healCoverage}/6
                          </div>
                        )}
                        {/* MP water warning */}
                        {MAP_PLATFORM_DATA[mapId] && MAP_PLATFORM_DATA[mapId].mpWater && (
                          <div style={{ position:"absolute", bottom:20, left:0, right:0, background:"#1e3a5f", color:"#60a5fa", fontSize:8, fontWeight:700, padding:"1px 4px", textAlign:"center", letterSpacing:0.5 }}>
                            [~] MP WATER
                          </div>
                        )}
                        <div style={{ background:"#0d1117", padding:"2px 5px", fontSize:9, color:"#9ca3af", maxWidth:120, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }} title={name}>
                          {name}
                        </div>
                        {/* Auto-computed MC/Heal training scores, from Map.wz foothold geometry (see MAP_SCORES) */}
                        {MAP_SCORES[mapId] && (
                          <div style={{ display:"flex", gap:0 }}>
                            <div style={{ background:scoreColor(MAP_SCORES[mapId].mcScore), color:"#000", fontSize:8, fontWeight:700, padding:"1px 5px", flex:1, textAlign:"center" }}>
                              MC {MAP_SCORES[mapId].mcScore}/5
                            </div>
                            {m.undead && (
                              <div style={{ background:scoreColor(MAP_SCORES[mapId].healScore), color:"#000", fontSize:8, fontWeight:700, padding:"1px 5px", flex:1, textAlign:"center" }}>
                                HL {MAP_SCORES[mapId].healScore}/5
                              </div>
                            )}
                          </div>
                        )}
                        {/* Platform notes on hover via title - also show layout inline */}
                        {MAP_PLATFORM_DATA[mapId] && (
                          <div style={{ background:"#161b22", padding:"2px 5px", fontSize:8, color: MAP_PLATFORM_DATA[mapId].estimated ? "#4b5563" : "#6b7280", maxWidth:120, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                            {MAP_PLATFORM_DATA[mapId].platforms}p {MAP_PLATFORM_DATA[mapId].layout}{MAP_PLATFORM_DATA[mapId].estimated ? " *est" : ""}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
  );
}

export default function App() {
  // -- Configurable character panel ------------------------------------------
  const [charLevel, setCharLevel] = useState(DEFAULT_CHAR.level);
  const [charInt, setCharInt] = useState(DEFAULT_CHAR.int);
  const [charLuk, setCharLuk] = useState(DEFAULT_CHAR.luk);
  const [charWeaponMatk, setCharWeaponMatk] = useState(DEFAULT_CHAR.weaponMatk);
  const [charMpMax, setCharMpMax] = useState(DEFAULT_CHAR.mpMax);
  const [charExpPct, setCharExpPct] = useState(DEFAULT_CHAR.expPct);
  const [charPanelOpen, setCharPanelOpen] = useState(false);

  // Derived char object used everywhere
  const CHAR = useMemo(() => ({
    level: charLevel, int: charInt, luk: charLuk,
    weaponMatk: charWeaponMatk, mpMax: charMpMax,
  }), [charLevel, charInt, charLuk, charWeaponMatk, charMpMax]);

  const dmg = useMemo(() => calcDmg(CHAR.weaponMatk, CHAR.int), [CHAR]);

  const [query, setQuery] = useState("");
  const [levelMin, setLevelMin] = useState(1);
  const [levelMax, setLevelMax] = useState(100);
  const [bossOnly, setBossOnly] = useState(false);
  const [undeadOnly, setUndeadOnly] = useState(false);
  const [autoOnly, setAutoOnly] = useState(false);
  const [weakFilter, setWeakFilter] = useState(null); // e.g. "Fire", "Holy", "Lightning" -- exact match on m.weak
  const [effFilter, setEffFilter] = useState(null); // "low" | "mid" | "high" -- bucketed on m.ratio, matches effColor thresholds
  const [castsFilter, setCastsFilter] = useState(null); // [lo,hi] -- bucketed on m.hits (Magic Claw casts to kill)
  const [sortBy, setSortBy] = useState("efficiency");
  const [sortDir, setSortDir] = useState(1); // 1 = ascending, -1 = descending
  const [selected, setSelected] = useState(null);
  const [worldMapMapId, setWorldMapMapId] = useState(null);
  const [healLvl, setHealLvl] = useState(0);
  const [healTargets, setHealTargets] = useState(3);
  const [mpEaterLvl, setMpEaterLvl] = useState(0);
  const [sessionMins, setSessionMins] = useState(60);
  const [potionKey, setPotionKey] = useState("bluePotion");

  const filtered = useMemo(() => {
    let list = MONSTER_DB.filter(m => {
      if (bossOnly && !m.boss) return false;
      if (undeadOnly && !UNDEAD_IDS.has(m.id)) return false;
      if (autoOnly && !m.auto) return false;
      if (weakFilter && m.weak !== weakFilter) return false;
      if (m.level < levelMin || m.level > levelMax) return false;
      if (query) {
        const q = query.toLowerCase();
        if (!m.name.toLowerCase().includes(q) && !m.location.toLowerCase().includes(q) &&
            !m.weak.toLowerCase().includes(q) && !m.strong.toLowerCase().includes(q)) return false;
      }
      return true;
    });
    list = list.map(m => {
      const isUndead = UNDEAD_IDS.has(m.id);
      const hRatio = isUndead ? healEffRatio(m.hp, m.mDef, m.exp, healTargets) : null;
      const hCasts = isUndead ? healCastsToKill(m.hp, m.mDef, healLvl, healTargets, CHAR.int, CHAR.luk, CHAR.weaponMatk) : null;
      const hDmg = isUndead ? healDmg(healLvl, healTargets, CHAR.int, CHAR.luk, CHAR.weaponMatk) : null;
      // MP Eater: Heal fires once per target hit, Magic Claw fires 2 hits
      const healMpReturn = hDmg ? mpEaterExpectedReturn(mpEaterLvl, m.mp, healTargets) : 0;
      const mcMpReturn = mpEaterExpectedReturn(mpEaterLvl, m.mp, 2);
      const healNetMp = hDmg ? netMpCost(hDmg.mpCost, healMpReturn) : null;
      const mcNetMp = netMpCost(20, mcMpReturn);
      const healAnyProc = mpEaterAnyProcChance(mpEaterLvl, healTargets);
      const mcAnyProc = mpEaterAnyProcChance(mpEaterLvl, 2);
      // Compute hits early so it's available for session profit
      // Magic Claw = 2 hits/cast, each hit rolled off calcDmg independently, so per-cast min damage is 2x a single hit's min
      const hits = hitsToKill(m.hp, m.mDef, dmg.min * MC_HITS_PER_CAST);
      // Session profit
      const mcKillsPerCast = 1;
      const mcSession = sessionProfit(sessionMins, "mc", mcKillsPerCast, mcNetMp * hits, m.exp, CHAR.level, charExpPct, potionKey, CHAR.mpMax);
      const healSession = isUndead && hDmg && healLvl > 0
        ? sessionProfit(sessionMins, "heal", healTargets / (hCasts || 1), healNetMp ?? 0, m.exp, CHAR.level, charExpPct, potionKey, CHAR.mpMax)
        : null;
      return {
        ...m,
        undead: isUndead,
        effHP: m.hp + m.mDef,
        ratio: effRatio(m.hp, m.mDef, m.exp),
        hits,
        oneshotLvl: oneshotLevel(m.hp, m.mDef, CHAR),
        exp2x: m.exp * EXP_MULTI,
        healRatio: hRatio,
        healCasts: hCasts,
        healDmgMin: hDmg ? hDmg.min : null,
        healDmgMax: hDmg ? hDmg.max : null,
        healMpCost: hDmg ? hDmg.mpCost : null,
        healMpReturn,
        healNetMp,
        healAnyProc,
        mcNetMp,
        mcAnyProc,
        mcSession,
        healSession,
        spawnMaps: spawnMapsFor(m.id),
      };
    });
    // Second filter pass: efficiency/casts buckets need m.ratio/m.hits, which only
    // exist after enrichment above.
    if (effFilter) {
      list = list.filter(m => {
        if (effFilter === "high") return m.ratio < 4;
        if (effFilter === "mid") return m.ratio >= 4 && m.ratio < 6;
        if (effFilter === "low") return m.ratio >= 6;
        return true;
      });
    }
    if (castsFilter) {
      list = list.filter(m => m.hits >= castsFilter[0] && m.hits <= castsFilter[1]);
    }
    if (sortBy === "efficiency") list.sort((a,b) => sortDir*(a.ratio - b.ratio));
    else if (sortBy === "level") list.sort((a,b) => sortDir*(a.level - b.level));
    else if (sortBy === "exp") list.sort((a,b) => sortDir*(a.exp2x - b.exp2x));
    else if (sortBy === "hp") list.sort((a,b) => sortDir*(a.hp - b.hp));
    return list;
  }, [query, levelMin, levelMax, bossOnly, undeadOnly, autoOnly, weakFilter, effFilter, castsFilter, sortBy, sortDir, healLvl, healTargets, mpEaterLvl, sessionMins, potionKey, CHAR, dmg]);

  return (
    <div style={{ minHeight:"100vh", background:"#0d1117", fontFamily:"monospace", color:"#e2e8f0" }}>
      {/* Header */}
      <div style={{ background:"linear-gradient(180deg,#1a0a2e,#0d1117)", borderBottom:"2px solid #7c3aed", padding:"16px 20px 12px" }}>
        <div style={{ maxWidth:900, margin:"0 auto" }}>
          <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:8 }}>
            <span style={{ fontSize:24 }}>[Shroom]</span>
            <div>
              <div style={{ fontSize:18, fontWeight:700, color:"#a78bfa", letterSpacing:1 }}>MAPLESTORY MONSTER DB</div>
              <div style={{ fontSize:10, color:"#6b7280", letterSpacing:2 }}>LEGENDS.ML x MEOWDB x V62 PRE-BIG BANG x STARRYDREAM LV.{CHAR.level} x {MONSTER_DB.length} MONSTERS</div>
            </div>
          </div>
          <div style={{ display:"flex", gap:6, flexWrap:"wrap", padding:"6px 10px", background:"#161b22", borderRadius:6, border:"1px solid #21262d", fontSize:11 }}>
            <span style={{ color:"#6b7280" }}>STARRYDREAM:</span>
            {badge("INT", CHAR.int, "#6366f1")}
            {badge("M.ATT", CHAR.weaponMatk, "#8b5cf6")}
            {badge("MIN/HIT", dmg.min.toFixed(0), "#059669")}
            {badge("MAX/HIT", dmg.max.toFixed(0), "#10b981")}
            {badge("MP", CHAR.mpMax, "#0ea5e9")}
            <span style={{ color:"#4b5563" }}>+4 INT +1 LUK/lvl x Magic Claw Lv20 x2 hits/cast x 2x EXP</span>
          </div>
        </div>
      </div>

      <div style={{ maxWidth:900, margin:"0 auto", padding:"16px 12px" }}>

        {/* Character Panel */}
        <div style={{ marginBottom:12, border:"1px solid #30363d", borderRadius:8, overflow:"hidden" }}>
          <button onClick={()=>setCharPanelOpen(o=>!o)}
            style={{ width:"100%", background:"#161b22", border:"none", padding:"10px 14px", color:"#e2e8f0", fontFamily:"monospace", fontSize:12, cursor:"pointer", display:"flex", justifyContent:"space-between", alignItems:"center", textAlign:"left" }}>
            <span style={{ fontWeight:700, letterSpacing:1, color:"#a78bfa" }}>CHARACTER Lv{CHAR.level} {charPanelOpen ? "[close]" : "[edit]"}</span>
            <span style={{ color:"#6b7280", fontSize:11 }}>INT {CHAR.int} / LUK {CHAR.luk} / M.ATT {CHAR.weaponMatk} / {charExpPct.toFixed(2)}% exp / MIN {dmg.min.toFixed(0)}/hit MAX {dmg.max.toFixed(0)}/hit</span>
          </button>
          {charPanelOpen && (
            <div style={{ background:"#0d1117", padding:"12px 14px", display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:"10px 16px" }}>
              {[
                ["Level", charLevel, setCharLevel, 1, 70, 1],
                ["INT", charInt, setCharInt, 10, 999, 1],
                ["LUK", charLuk, setCharLuk, 4, 999, 1],
                ["Weapon M.ATT", charWeaponMatk, setCharWeaponMatk, 0, 200, 1],
                ["Max MP", charMpMax, setCharMpMax, 100, 30000, 10],
                ["Current EXP %", charExpPct, setCharExpPct, 0, 99.99, 0.01],
              ].map(([label, val, setter, min, max, step]) => (
                <div key={label}>
                  <div style={{ fontSize:10, color:"#6b7280", marginBottom:3, letterSpacing:1 }}>{label.toUpperCase()}</div>
                  <input type="number" value={val} min={min} max={max} step={step}
                    onChange={e => setter(step < 1 ? parseFloat(e.target.value)||0 : parseInt(e.target.value)||0)}
                    style={{ width:"100%", background:"#161b22", border:"1px solid #30363d", borderRadius:4, padding:"4px 8px", color:"#e2e8f0", fontFamily:"monospace", fontSize:12, boxSizing:"border-box" }} />
                </div>
              ))}
              <div style={{ gridColumn:"1/-1", display:"flex", alignItems:"center", gap:12 }}>
                <button onClick={() => {
                  setCharLevel(DEFAULT_CHAR.level); setCharInt(DEFAULT_CHAR.int);
                  setCharLuk(DEFAULT_CHAR.luk); setCharWeaponMatk(DEFAULT_CHAR.weaponMatk);
                  setCharMpMax(DEFAULT_CHAR.mpMax); setCharExpPct(DEFAULT_CHAR.expPct);
                }} style={{ background:"#21262d", border:"1px solid #30363d", borderRadius:4, padding:"4px 12px", color:"#9ca3af", fontFamily:"monospace", fontSize:11, cursor:"pointer" }}>
                  Reset to defaults
                </button>
                <span style={{ fontSize:10, color:"#4b5563" }}>
                  Projections assume +{INT_PER_LEVEL} INT / +{LUK_PER_LEVEL} LUK per level-up
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Controls */}
        <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:12 }}>
          <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search name, location, element..."
            style={{ flex:1, minWidth:180, background:"#161b22", border:"1px solid #30363d", borderRadius:6, padding:"8px 12px", color:"#e2e8f0", fontFamily:"inherit", fontSize:12 }} />
          <input type="number" value={levelMin} onChange={e=>setLevelMin(+e.target.value)} placeholder="Min Lv"
            style={{ width:70, background:"#161b22", border:"1px solid #30363d", borderRadius:6, padding:"8px", color:"#e2e8f0", fontFamily:"inherit", fontSize:12, textAlign:"center" }} />
          <span style={{ lineHeight:"34px", color:"#6b7280" }}>-</span>
          <input type="number" value={levelMax} onChange={e=>setLevelMax(+e.target.value)} placeholder="Max Lv"
            style={{ width:70, background:"#161b22", border:"1px solid #30363d", borderRadius:6, padding:"8px", color:"#e2e8f0", fontFamily:"inherit", fontSize:12, textAlign:"center" }} />
          <select value={sortBy} onChange={e=>setSortBy(e.target.value)}
            style={{ background:"#161b22", border:"1px solid #30363d", borderRadius:6, padding:"8px", color:"#e2e8f0", fontFamily:"inherit", fontSize:12 }}>
            <option value="efficiency">Sort: Efficiency</option>
            <option value="level">Sort: Level</option>
            <option value="exp">Sort: EXP</option>
            <option value="hp">Sort: HP</option>
          </select>
          <button onClick={()=>setSortDir(d=>-d)}
            title={sortDir===1 ? "Ascending (lowest first) -- click for descending" : "Descending (highest first) -- click for ascending"}
            style={{ background:"#161b22", border:"1px solid #30363d", borderRadius:6, padding:"8px 12px", color:"#e2e8f0", fontFamily:"inherit", fontSize:12, cursor:"pointer", display:"flex", alignItems:"center", gap:4 }}>
            {sortDir===1 ? "^ Asc" : "v Desc"}
          </button>
        </div>

        {/* Heal controls */}
        <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:12, padding:"10px 12px", background:"#161b22", border:"1px solid #21262d", borderRadius:6 }}>
          <span style={{ fontSize:11, color:"#86efac", fontWeight:700, letterSpacing:1 }}>+ HEAL</span>
          <FilterRow label="Skill Lv">
            <input type="range" min={0} max={30} value={healLvl} onChange={e=>setHealLvl(+e.target.value)}
              style={{ width:100, accentColor:"#86efac" }} />
            <span style={{ color:"#86efac", fontWeight:700, minWidth:20 }}>{healLvl}</span>
            <span style={{ color:"#4b5563", fontSize:11 }}>({healLvl===0?"disabled":`${healLvl*15}% x ${29+healLvl} MP`})</span>
          </FilterRow>
          <FilterRow label="Targets">
            <input type="range" min={1} max={6} value={healTargets} onChange={e=>setHealTargets(+e.target.value)}
              style={{ width:80, accentColor:"#86efac" }} />
            <span style={{ color:"#86efac", fontWeight:700 }}>{healTargets}</span>
            <span style={{ color:"#4b5563", fontSize:11 }}>(mult x{(1.5 + 5/healTargets).toFixed(2)})</span>
          </FilterRow>
          <FilterRow label="MP Eater Lv">
            <input type="range" min={0} max={20} value={mpEaterLvl} onChange={e=>setMpEaterLvl(+e.target.value)}
              style={{ width:80, accentColor:"#60a5fa" }} />
            <span style={{ color:"#60a5fa", fontWeight:700, minWidth:20 }}>{mpEaterLvl}</span>
            <span style={{ color:"#4b5563", fontSize:11 }}>
              {mpEaterLvl===0 ? "(disabled)" : `(${mpEaterLvl}% chance, absorb ${(mpEaterLvl/2).toFixed(1)}% mob MP)`}
            </span>
          </FilterRow>
          <FilterRow label="Session">
            <input type="range" min={10} max={180} step={10} value={sessionMins} onChange={e=>setSessionMins(+e.target.value)}
              style={{ width:100, accentColor:"#f59e0b" }} />
            <span style={{ color:"#f59e0b", fontWeight:700, minWidth:30 }}>{sessionMins}m</span>
          </FilterRow>
          <FilterRow label="Potion">
            <select value={potionKey} onChange={e=>setPotionKey(e.target.value)}
              style={{ background:"#0d1117", color:"#e5e7eb", border:"1px solid #21262d", borderRadius:4, fontSize:11, padding:"2px 4px" }}>
              {Object.entries(POTIONS).map(([key, p]) => (
                <option key={key} value={key}>{p.label}</option>
              ))}
            </select>
          </FilterRow>
          {healLvl > 0 && (
            <div style={{ fontSize:11, color:"#4b5563" }}>
              Heal dmg vs undead: <span style={{ color:"#86efac" }}>{healDmg(healLvl, healTargets, CHAR.int, CHAR.luk, CHAR.weaponMatk).min.toFixed(0)}</span>-<span style={{ color:"#86efac" }}>{healDmg(healLvl, healTargets, CHAR.int, CHAR.luk, CHAR.weaponMatk).max.toFixed(0)}</span> per target
            </div>
          )}
        </div>

        {/* Quick filters -- grouped by category, each its own labeled row */}
        <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:16 }}>
          <FilterRow label="Level Range">
            {[["My range",17,25],["Low",1,15],["Mid",20,35],["High",35,60],["All",1,100]].map(([l,mn,mx])=>(
              <button key={l} onClick={()=>{setLevelMin(mn);setLevelMax(mx);}}
                style={{ background:"#161b22", border:`1px solid ${levelMin===mn&&levelMax===mx?"#7c3aed":"#30363d"}`, borderRadius:4, padding:"3px 10px", color:levelMin===mn&&levelMax===mx?"#a78bfa":"#9ca3af", fontFamily:"inherit", fontSize:11, cursor:"pointer" }}>
                {l}
              </button>
            ))}
          </FilterRow>

          <FilterRow label="Elemental Weakness">
            {[["Lightning","Lightning"],["Holy","Holy"],["Fire","Fire"]].map(([l,w])=>(
              <button key={l} onClick={()=>setWeakFilter(f=>f===w?null:w)}
                style={{ background:"#161b22", border:`1px solid ${weakFilter===w?"#7c3aed":"#30363d"}`, borderRadius:4, padding:"3px 10px", color:weakFilter===w?"#a78bfa":"#9ca3af", fontFamily:"inherit", fontSize:11, cursor:"pointer", fontWeight:weakFilter===w?700:400 }}>
                {l}
              </button>
            ))}
          </FilterRow>

          <FilterRow label="Efficiency" hint="EFF RATIO = (HP+M.DEF)/(EXPx2), lower is better">
            {[["Low","low"],["Mid","mid"],["High","high"]].map(([l,v])=>(
              <button key={l} onClick={()=>setEffFilter(f=>f===v?null:v)}
                style={{ background:"#161b22", border:`1px solid ${effFilter===v?"#7c3aed":"#30363d"}`, borderRadius:4, padding:"3px 10px", color:effFilter===v?"#a78bfa":"#9ca3af", fontFamily:"inherit", fontSize:11, cursor:"pointer", fontWeight:effFilter===v?700:400 }}>
                {l}
              </button>
            ))}
          </FilterRow>

          <FilterRow label="Casts" hint="Magic Claw casts to kill -- high efficiency is no good if it takes 40 casts">
            {[["OHKO",[1,1]],["2",[2,2]],["3",[3,3]],["4-10",[4,10]]].map(([l,range])=>(
              <button key={l} onClick={()=>setCastsFilter(f=>(f && f[0]===range[0] && f[1]===range[1]) ? null : range)}
                style={{ background:"#161b22", border:`1px solid ${castsFilter&&castsFilter[0]===range[0]&&castsFilter[1]===range[1]?"#7c3aed":"#30363d"}`, borderRadius:4, padding:"3px 10px", color:castsFilter&&castsFilter[0]===range[0]&&castsFilter[1]===range[1]?"#a78bfa":"#9ca3af", fontFamily:"inherit", fontSize:11, cursor:"pointer", fontWeight:castsFilter&&castsFilter[0]===range[0]&&castsFilter[1]===range[1]?700:400 }}>
                {l}
              </button>
            ))}
          </FilterRow>

          <FilterRow label="Type">
            <button onClick={()=>setBossOnly(v=>!v)}
              style={{ background:"#161b22", border:`1px solid ${bossOnly?"#7f1d1d":"#30363d"}`, borderRadius:4, padding:"3px 10px", color:bossOnly?"#fca5a5":"#9ca3af", fontFamily:"inherit", fontSize:11, cursor:"pointer", fontWeight:bossOnly?700:400 }}>
              Boss
            </button>
            <button onClick={()=>setUndeadOnly(v=>!v)}
              style={{ background:"#161b22", border:`1px solid ${undeadOnly?"#14532d":"#30363d"}`, borderRadius:4, padding:"3px 10px", color:undeadOnly?"#86efac":"#9ca3af", fontFamily:"inherit", fontSize:11, cursor:"pointer", fontWeight:undeadOnly?700:400 }}>
              + Undead
            </button>
            <button onClick={()=>setAutoOnly(v=>!v)}
              style={{ background:"#161b22", border:`1px solid ${autoOnly?"#3f2d0d":"#30363d"}`, borderRadius:4, padding:"3px 10px", color:autoOnly?"#fbbf24":"#9ca3af", fontFamily:"inherit", fontSize:11, cursor:"pointer", fontWeight:autoOnly?700:400 }}>
              Normal
            </button>
          </FilterRow>

          {(query || weakFilter || effFilter || castsFilter) && (
            <div>
              <button onClick={()=>{setQuery("");setWeakFilter(null);setEffFilter(null);setCastsFilter(null);}}
                style={{ background:"#7c3aed22", border:"1px solid #7c3aed", borderRadius:4, padding:"3px 10px", color:"#a78bfa", fontFamily:"inherit", fontSize:11, cursor:"pointer" }}>
                x Clear filters
              </button>
            </div>
          )}
        </div>

        <div style={{ fontSize:11, color:"#4b5563", marginBottom:10, letterSpacing:1 }}>
          {filtered.length} MONSTER{filtered.length!==1?"S":""} x EFF RATIO = (HP+M.DEF)/(EXPx2) x LOWER = BETTER FOR MAGIC
        </div>

        {/* Monster list */}
        <div style={{ display:"grid", gap:8 }}>
        {/* Monster list -- virtualized: only visibly-nearby cards are actually
            mounted, since each card can include several real spawn-map images */}
        <VirtualList
          items={filtered}
          estimatedItemHeight={190}
          overscan={6}
          renderItem={(m, i) => (
            <MonsterCard key={m.id} m={m} i={i} selected={selected} setSelected={setSelected}
              setWorldMapMapId={setWorldMapMapId} CHAR={CHAR} dmg={dmg} healLvl={healLvl}
              healTargets={healTargets} mpEaterLvl={mpEaterLvl} sessionMins={sessionMins} potionKey={potionKey} />
          )}
        />
        </div>

        {filtered.length === 0 && (
          <div style={{ textAlign:"center", padding:"40px 0", color:"#6b7280", fontSize:13 }}>
            No monsters match your filters.
          </div>
        )}

        <div style={{ marginTop:24, fontSize:10, color:"#374151", textAlign:"center", lineHeight:1.8 }}>
          SOURCE: MEOWDB.COM/MSCLASSIC + LEGENDS.ML/LIB/MONSTER x {MONSTER_DB.length} MONSTERS INDEXED<br/>
          SPAWN MAPS: {Object.keys(REAL_SPAWNS).length}/{MONSTER_DB.length} MONSTERS MAP.WZ-VERIFIED, REST ARE CURATED/UNVERIFIED<br/>
          STATS: {STAT_VERIFIED_IDS.size}/{MONSTER_DB.length} MONSTERS INDIVIDUALLY VERIFIED VS MAPLELEGENDS (LEGENDS.ML + COSMIC V83 CROSSWALK)<br/>
          {MONSTER_DB.filter(m=>m.auto).length} ADDITIONAL MONSTERS (NORMAL) SOURCED FROM THE SAME COSMIC V83 DUMP (NOT INDIVIDUALLY SPOT-CHECKED)<br/>
          MAP SCORES: DERIVED FROM MAP.WZ FOOTHOLD + MOB-SPAWN GEOMETRY x {Object.keys(MAP_SCORES).length} MAPS SCORED<br/>
          EFF RATIO = (HP + M.DEF) / (EXP x 2) x DAMAGE FORMULA: V62 MAGIC CLAW LV20
        </div>
      </div>

      {worldMapMapId !== null && (
        <MapExpandModal mapId={worldMapMapId} onClose={()=>setWorldMapMapId(null)} />
      )}
    </div>
  );
}

// -- Expanded map view: local minimap thumbnail + world map with a marker at this
// map's location, shown side by side. Falls back gracefully to thumbnail-only if
// this map has no resolved world-map spot (e.g. a handful of Maple Island tutorial
// maps whose regional world-map image wasn't included in the WorldMap.wz extract).
function MapExpandModal({ mapId, onClose }) {
  const spotInfo = WORLD_MAP_DATA.spots[mapId];
  const region = spotInfo ? WORLD_MAP_DATA.regions[spotInfo.region] : null;
  const worldImg = spotInfo && `data/worldmaps/${spotInfo.region}.png`;
  const mapNameFull = (typeof MAP_NAMES !== "undefined" && MAP_NAMES[mapId]) || null;

  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, background:"#000000cc", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}>
      <div onClick={e=>e.stopPropagation()} style={{ background:"#161b22", border:"1px solid #30363d", borderRadius:8, padding:16, maxWidth:900, width:"100%", maxHeight:"90vh", overflow:"auto" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
          <div>
            {/* Styled like the in-game minimap's map-name bar: "Street : Map Name" */}
            <div style={{ color:"#e2e8f0", fontWeight:700, fontSize:14 }}>
              {mapNameFull || `Map #${mapId}`}
            </div>
            <div style={{ color:"#6b7280", fontSize:10, letterSpacing:1, marginTop:2 }}>MAP #{mapId}</div>
          </div>
          <button onClick={onClose} style={{ background:"#21262d", border:"1px solid #30363d", borderRadius:4, color:"#e2e8f0", fontFamily:"inherit", fontSize:12, padding:"4px 10px", cursor:"pointer" }}>
            [x] Close
          </button>
        </div>
        <div style={{ display:"flex", gap:16, flexWrap:"wrap" }}>
          <div style={{ flex:"1 1 260px" }}>
            <div style={{ fontSize:10, color:"#6b7280", marginBottom:6, letterSpacing:1 }}>MINIMAP</div>
            <img src={mapImg(mapId)} alt={mapNameFull || `Map ${mapId}`}
              style={{ width:"100%", maxWidth:400, imageRendering:"pixelated", background:"#0d1117", border:"1px solid #30363d", borderRadius:4, display:"block" }}
              onError={e=>{
                if (!e.target.dataset.triedFallback) {
                  e.target.dataset.triedFallback = "1";
                  e.target.src = mapImgFallback(mapId);
                }
              }} />
            {/* In-game minimaps show the map name directly under/over the map itself --
                mirrored here so it's obvious at a glance which map this thumbnail is. */}
            <div style={{ marginTop:4, padding:"4px 8px", background:"#0d1117", border:"1px solid #30363d", borderRadius:4, fontSize:11, color:"#e2e8f0", textAlign:"center" }}>
              {mapNameFull || `Map #${mapId} (name unavailable)`}
            </div>
          </div>
          <div style={{ flex:"1 1 260px" }}>
            <div style={{ fontSize:10, color:"#6b7280", marginBottom:6, letterSpacing:1 }}>WORLD MAP LOCATION</div>
            {worldImg ? (
              <div style={{ position:"relative", width:"100%", maxWidth:400, border:"1px solid #30363d", borderRadius:4, overflow:"hidden" }}>
                <img src={worldImg} alt={spotInfo.region}
                  style={{ width:"100%", display:"block", background:"#0d1117" }} />
                <div style={{
                  position:"absolute",
                  left:`${((spotInfo.x + region.originX) / region.width) * 100}%`,
                  top:`${((spotInfo.y + region.originY) / region.height) * 100}%`,
                  transform:"translate(-50%,-50%)",
                  width:14, height:14, borderRadius:"50%",
                  background:"#ef4444", border:"2px solid #fff",
                  boxShadow:"0 0 0 3px #ef444488",
                }} />
              </div>
            ) : (
              <div style={{ width:"100%", maxWidth:400, height:200, border:"1px dashed #30363d", borderRadius:4, display:"flex", alignItems:"center", justifyContent:"center", color:"#6b7280", fontSize:11, textAlign:"center", padding:12 }}>
                World map location not available for this map
                <br/>(no resolved spot in the WorldMap.wz extract)
              </div>
            )}
            {/* Same name label under the world map view, so it's unambiguous which
                marker corresponds to which map even at a glance. */}
            <div style={{ marginTop:4, padding:"4px 8px", background:"#0d1117", border:"1px solid #30363d", borderRadius:4, fontSize:11, color:"#e2e8f0", textAlign:"center" }}>
              {mapNameFull || `Map #${mapId} (name unavailable)`}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
