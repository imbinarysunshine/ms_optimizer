// SUPERSEDED by tools/recompute_map_scores.mjs -- see README.md "Map-quality
// scoring" for the gap-aware floor-penalty and neighboring-platform-clumping
// fixes this file's meleeScore()/aoeScore() didn't have.
//
// Extends the existing mcScore/healScore map-quality scores (see analyze_maps.py)
// with two more per-map scores, one for each additional skill "hitbox archetype"
// discovered while sourcing every class's real v62 skill data this session (see
// src/lib/classSkills.js and the Skill.wz range/mobCount/lt-rb fields each skill
// carries):
//
//   - meleeScore: single-target skills on a short-reach weapon (sword/knuckle/
//     dagger-vs-non-thief -- see WEAPON_MULTIPLIERS in formulas.js). mcScore already
//     covers single-target RANGED skills (bow/claw/wand/staff/gun -- MC_RANGE_PX=425
//     was always really "ranged spell/arrow reach", not Magic-Claw-specific), so
//     melee just reuses that exact formula shape with a much shorter reach constant.
//   - aoeScore: same-platform radius AoE skills (Slash Blast, Somersault Kick,
//     Arrow Bomb, Backspin/Corkscrew Blow, Grenade, Blank Shot, Thunder Bolt --
//     every one of these has an explicit Skill.wz mobCount + a SMALL vertical
//     lt/rb box, well under Heal's own -200..200). These want dense mob clumps on
//     ONE platform, not multi-floor vertical stacking (healScore's specialty) --
//     rewarding vertical alignment the way healScore does would be actively wrong
//     for them, since their box can't reach an adjacent floor at all.
//
// Hitbox constants below are read directly from each skill's own Skill.wz entry at
// its max level (see the classSkills.js/formulas.js header comments for the exact
// ids) -- MELEE_RANGE_PX is the one number NOT wz-derived (single-target melee
// skills carry no skill-level range field at all; they inherit the character's
// innate weapon-swing reach, which lives in a different wz location -- Item.wz
// per-weapon animation data -- not mined this session). 150px is a conservative
// "same or adjacent standing spot" estimate, deliberately much shorter than
// MC_RANGE_PX=425 -- exact calibration TODO if this matters more precisely later.
//
// Output: merges meleeScore/aoeScore (+ Raw variants, matching mcScoreRaw/
// healScoreRaw's already-established convention) into public/data/mapScores.js
// in place, alongside the existing fields -- doesn't touch mcScore/healScore.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAP_ROOT = "G:\\git-clones\\Cosmic\\wz\\Map.wz\\Map";
const SCORES_PATH = path.join(__dirname, "..", "public", "data", "mapScores.js");

const MC_RANGE_PX = 425;      // matches analyze_maps.py's existing constant
const MELEE_RANGE_PX = 150;   // see header comment -- not wz-derived, flagged
// Per-skill AoE reach, in px, averaged from each skill's own Skill.wz range/lt-rb
// box at max level (see the extraction table in this session's chat, or re-derive
// via the same lt/rb-block-walking approach extract_rope_data.mjs uses for ropes).
// Used only to pick a representative AOE_RANGE_PX below -- the aoeScore formula
// itself doesn't vary per skill (all these skills share the same "clump density on
// one platform" shape), so one representative constant covers the whole archetype.
const AOE_SKILL_REACH_PX = {
  slashBlast: 150, arrowBomb: 150, crossbowmanAoe: 150,        // range field
  somersaultKick: 76, backspinBlow: 140, corkscrewBlow: 200,   // lt/rb width
  grenade: 240, blankShot: 240, thunderBolt: 340,
};
const AOE_RANGE_PX = Math.round(
  Object.values(AOE_SKILL_REACH_PX).reduce((a, b) => a + b, 0) / Object.values(AOE_SKILL_REACH_PX).length
); // ~180px average clump radius

const FLAT_TOL_Y = 4;
const YBAND_MERGE_GAP = 15;
const XGAP_MERGE = 60;
const MIN_PLATFORM_LEN = 20;

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function attr(line, name) {
  const m = line.match(new RegExp(`name="${name}"[^>]*value="(-?[0-9.]+)"`));
  return m ? Number(m[1]) : null;
}
function strAttr(line, name) {
  const m = line.match(new RegExp(`name="${name}"[^>]*value="([^"]*)"`));
  return m ? m[1] : null;
}

function extractBlock(lines, startIdx) {
  let depth = 0;
  for (let i = startIdx; i < lines.length; i++) {
    const isOpen = /<imgdir /.test(lines[i]) && !lines[i].includes("/>");
    const isClose = /<\/imgdir>/.test(lines[i]);
    if (isOpen) depth++;
    if (isClose) {
      depth--;
      if (depth === 0) return [lines.slice(startIdx, i + 1), i];
    }
  }
  return [lines.slice(startIdx), lines.length - 1];
}

function findChildBlock(lines, name) {
  const idx = lines.findIndex(l => new RegExp(`<imgdir name="${name}">`).test(l));
  if (idx === -1) return null;
  const [block] = extractBlock(lines, idx);
  return block;
}

// -- foothold -> platforms (direct JS port of analyze_maps.py's cluster_platforms) --
function collectFootholds(fhBlock) {
  const segs = [];
  let cur = null;
  for (const line of fhBlock) {
    if (/<imgdir name="\d+">/.test(line)) {
      if (cur && cur.x1 !== null && cur.y1 !== null && cur.x2 !== null && cur.y2 !== null) {
        segs.push([cur.x1, cur.y1, cur.x2, cur.y2]);
      }
      cur = { x1: null, y1: null, x2: null, y2: null };
    } else if (cur) {
      if (line.includes('name="x1"')) cur.x1 = attr(line, "x1");
      else if (line.includes('name="y1"')) cur.y1 = attr(line, "y1");
      else if (line.includes('name="x2"')) cur.x2 = attr(line, "x2");
      else if (line.includes('name="y2"')) cur.y2 = attr(line, "y2");
    }
  }
  if (cur && cur.x1 !== null && cur.y1 !== null && cur.x2 !== null && cur.y2 !== null) {
    segs.push([cur.x1, cur.y1, cur.x2, cur.y2]);
  }
  return segs;
}

function collectMobs(lifeBlock) {
  const mobs = [];
  let cur = null;
  for (const line of lifeBlock) {
    if (/<imgdir name="[^"]+">/.test(line) && !/name="(x|y|cy|fh|f|hide|info|type|id)"/.test(line)) {
      if (cur && cur.type === "m" && cur.x !== null && (cur.cy !== null || cur.y !== null)) {
        mobs.push({ x: cur.x, cy: cur.cy !== null ? cur.cy : cur.y });
      }
      cur = { type: null, x: null, y: null, cy: null };
    } else if (cur) {
      if (line.includes('name="type"')) cur.type = strAttr(line, "type");
      else if (line.includes('name="x"')) cur.x = attr(line, "x");
      else if (line.includes('name="cy"')) cur.cy = attr(line, "cy");
      else if (line.includes('name="y"')) cur.y = attr(line, "y");
    }
  }
  if (cur && cur.type === "m" && cur.x !== null && (cur.cy !== null || cur.y !== null)) {
    mobs.push({ x: cur.x, cy: cur.cy !== null ? cur.cy : cur.y });
  }
  return mobs;
}

function clusterPlatforms(footholds) {
  const flats = [];
  for (const [x1, y1, x2, y2] of footholds) {
    if (Math.abs(y1 - y2) > FLAT_TOL_Y) continue;
    const xlo = Math.min(x1, x2), xhi = Math.max(x1, x2);
    if (xhi - xlo < 1) continue;
    flats.push([(y1 + y2) / 2, xlo, xhi]);
  }
  if (!flats.length) return [];
  flats.sort((a, b) => a[0] - b[0]);

  const bands = [];
  for (const [y, xlo, xhi] of flats) {
    let placed = false;
    for (const b of bands) {
      if (Math.abs(y - b.yMean) <= YBAND_MERGE_GAP) {
        b.segs.push([xlo, xhi]); b.ys.push(y);
        b.yMean = b.ys.reduce((a, c) => a + c, 0) / b.ys.length;
        placed = true; break;
      }
    }
    if (!placed) bands.push({ yMean: y, ys: [y], segs: [[xlo, xhi]] });
  }
  bands.sort((a, b) => a.yMean - b.yMean);
  const mergedBands = [];
  for (const b of bands) {
    const last = mergedBands[mergedBands.length - 1];
    if (last && Math.abs(b.yMean - last.yMean) <= YBAND_MERGE_GAP) {
      last.segs.push(...b.segs); last.ys.push(...b.ys);
      last.yMean = last.ys.reduce((a, c) => a + c, 0) / last.ys.length;
    } else {
      mergedBands.push(b);
    }
  }

  const platforms = [];
  for (const b of mergedBands) {
    const segs = b.segs.slice().sort((a, c) => a[0] - c[0]);
    let [curLo, curHi] = segs[0];
    for (const [xlo, xhi] of segs.slice(1)) {
      if (xlo - curHi <= XGAP_MERGE) {
        curHi = Math.max(curHi, xhi);
      } else {
        if (curHi - curLo >= MIN_PLATFORM_LEN) platforms.push({ y: b.yMean, xmin: curLo, xmax: curHi, len: curHi - curLo });
        [curLo, curHi] = [xlo, xhi];
      }
    }
    if (curHi - curLo >= MIN_PLATFORM_LEN) platforms.push({ y: b.yMean, xmin: curLo, xmax: curHi, len: curHi - curLo });
  }
  return platforms;
}

function assignMobsToPlatforms(platforms, mobs) {
  for (const p of platforms) p.mobCount = 0;
  for (const m of mobs) {
    let best = null, bestD = null;
    for (const p of platforms) {
      if (p.xmin - 60 <= m.x && m.x <= p.xmax + 60) {
        const d = Math.abs(m.cy - p.y);
        if (d <= 60 && (bestD === null || d < bestD)) { best = p; bestD = d; }
      }
    }
    if (best) best.mobCount++;
  }
}

// -- new scores --------------------------------------------------------------
// meleeScore: mcScore's exact shape, just with a much shorter reach constant (see
// header comment) -- short-reach single-target skills don't benefit from
// extra-long platforms past that point, so this saturates length_score sooner and
// leans more on floor_penalty/density than mcScore does for the same map.
function meleeScore(usedPlatforms, totalMobs) {
  const nFloors = usedPlatforms.length;
  const avgLen = usedPlatforms.reduce((s, p) => s + p.len, 0) / nFloors;
  const lengthScore = clamp(avgLen / (MELEE_RANGE_PX * 2), 0, 1);
  const floorPenalty = 1 / (1 + Math.max(0, nFloors - 1) * 0.4);
  const mobsPerPlatform = totalMobs / nFloors;
  const densityScore = clamp(mobsPerPlatform / 3, 0, 1);
  const raw = 0.45 * lengthScore + 0.35 * floorPenalty + 0.20 * densityScore;
  return clamp(Math.round(1 + raw * 4), 1, 5);
}

// aoeScore: rewards mob CLUMPING within one AoE-radius-sized window on the
// best single platform (not spread across the whole platform length, and not
// stacked across floors -- these skills' box is too small vertically for that,
// unlike Heal). floor_penalty kept from mcScore's shape since repositioning
// between AoE-farming floors is exactly as tedious as it is for any other skill.
function aoeScore(usedPlatforms, mobs) {
  const nFloors = usedPlatforms.length;
  let bestClump = 0;
  for (const p of usedPlatforms) {
    const onPlatform = mobs.filter(m => p.xmin - 60 <= m.x && m.x <= p.xmax + 60 && Math.abs(m.cy - p.y) <= 60);
    if (!onPlatform.length) continue;
    // slide an AOE_RANGE_PX*2-wide window across this platform's mobs, count max mobs caught
    const xs = onPlatform.map(m => m.x).sort((a, b) => a - b);
    let maxInWindow = 0;
    for (const cx of xs) {
      const inWindow = xs.filter(x => Math.abs(x - cx) <= AOE_RANGE_PX).length;
      if (inWindow > maxInWindow) maxInWindow = inWindow;
    }
    if (maxInWindow > bestClump) bestClump = maxInWindow;
  }
  const clumpScore = clamp(bestClump / 5, 0, 1); // 5+ mobs in one AoE window = max clump value
  const floorPenalty = 1 / (1 + Math.max(0, nFloors - 1) * 0.4);
  const raw = 0.55 * clumpScore + 0.45 * floorPenalty;
  return clamp(Math.round(1 + raw * 4), 1, 5);
}

function processFile(filePath, knownIds) {
  const mapId = Number(path.basename(filePath, ".img.xml"));
  if (!Number.isFinite(mapId) || !knownIds.has(mapId)) return null;

  const lines = fs.readFileSync(filePath, "utf8").split("\n");
  const fhBlock = findChildBlock(lines, "foothold");
  const lifeBlock = findChildBlock(lines, "life");
  if (!fhBlock) return null;

  const footholds = collectFootholds(fhBlock);
  const mobs = lifeBlock ? collectMobs(lifeBlock) : [];
  const platforms = clusterPlatforms(footholds);
  assignMobsToPlatforms(platforms, mobs);

  const mobPlatforms = platforms.filter(p => p.mobCount > 0);
  const used = mobPlatforms.length ? mobPlatforms : platforms;
  if (!used.length) return null;

  return {
    mapId,
    meleeScoreRaw: meleeScore(used, mobs.length),
    aoeScoreRaw: aoeScore(used, mobs),
  };
}

function main() {
  const src = fs.readFileSync(SCORES_PATH, "utf8");
  const jsonStart = src.indexOf("{");
  const jsonEnd = src.lastIndexOf("}") + 1;
  const scores = JSON.parse(src.slice(jsonStart, jsonEnd));
  const knownIds = new Set(Object.keys(scores).map(Number));

  const files = [];
  for (const sub of fs.readdirSync(MAP_ROOT)) {
    const subPath = path.join(MAP_ROOT, sub);
    if (!fs.statSync(subPath).isDirectory()) continue;
    for (const f of fs.readdirSync(subPath)) {
      if (f.endsWith(".img.xml")) files.push(path.join(subPath, f));
    }
  }
  console.error(`Found ${files.length} map files, ${knownIds.size} known scored maps`);

  let processed = 0, matched = 0;
  for (const f of files) {
    const r = processFile(f, knownIds);
    processed++;
    if (processed % 500 === 0) console.error(`  ${processed}/${files.length}`);
    if (!r) continue;
    matched++;
    const entry = scores[r.mapId];
    entry.meleeScoreRaw = r.meleeScoreRaw;
    entry.aoeScoreRaw = r.aoeScoreRaw;
    // Apply the same rope-travel and low-spawn penalties already computed for
    // mcScore/healScore (see extract_rope_data.mjs / apply_spawn_penalty.mjs) --
    // reuse the existing per-map penalty deltas rather than recomputing them.
    const mcPenalty = (entry.mcScoreRaw ?? entry.mcScore) - entry.mcScore;
    const healPenalty = (entry.healScoreRaw ?? entry.healScore) - entry.healScore;
    entry.meleeScore = clamp(entry.meleeScoreRaw - mcPenalty, 1, 5); // melee shares mc's floor-hop/rope penalty shape
    entry.aoeScore = clamp(entry.aoeScoreRaw - Math.min(mcPenalty, healPenalty), 1, 5);
  }
  console.error(`Done: ${processed} files scanned, ${matched} known maps matched`);

  const header = src.slice(0, jsonStart);
  fs.writeFileSync(SCORES_PATH, header + JSON.stringify(scores) + ";\n");
  console.error(`Wrote ${SCORES_PATH}`);
}

main();
