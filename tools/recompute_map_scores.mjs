// Recomputes mcScore/healScore/meleeScore/aoeScore for every map, fixing two real
// bugs found while reassessing Kerning City Subway: Line 1 <Area 1> (mapId
// 103000101) against its actual layout: 12 platforms stacked in gaps of 2-91px
// (one 460 solid ~3000px-wide bottom platform plus many short ones above it) --
// a genuinely tight, easy-to-farm stack -- yet it scored mcScore=3/aoeScore=2.
//
// Bug 1 (floor_penalty ignores gap size): the original formula
// (analyze_maps.py's score_map, ported faithfully into extract_skill_map_scores.mjs)
// charges a FLAT 0.4 tedium unit per extra mob-bearing floor, whether that floor is
// 20px away (basically the same standing spot) or 500px away (a real climb/jump).
// 103000101 has 11 floors at an 82px AVERAGE gap -- the flat formula treated that
// as if it were 11 floors at a real-repositioning distance, tanking floor_penalty
// to 0.2. Fixed below: floor_penalty is now the sum of PER-GAP tedium, each scaled
// by how large that specific gap actually is (GAP_REFERENCE_PX=350 is where a gap
// costs the old full 0.4 unit; smaller gaps cost proportionally less, matching how
// healScore's own gap_score already treats small gaps as cheap).
//
// Bug 2 (aoeScore only clumps mobs on ONE platform): Slash Blast/Thunder Bolt/etc.
// all have a real (if small) vertical reach (~50-140px per each skill's own Skill.wz
// lt/rb box, see classSkills.js) -- on a tightly-stacked map like this one, that's
// often enough to also catch mobs on the platform directly above/below. The old
// aoeScore never considered this. Fixed below: the clump window now also pulls in
// mobs from platforms within AOE_VERTICAL_REACH_PX of the anchor platform.
//
// Bug 3 (rope penalty ignores gap size, same root cause as Bug 1): a rope
// connecting two platforms 20px apart is a non-event; the original penalty
// (extract_rope_data.mjs) only gated on floor count + rope count, not the actual
// gap being climbed. Fixed below: same per-gap tightness discount as Bug 1's
// floor_penalty, applied to the rope coverage penalty.
//
// This supersedes analyze_maps.py + extract_rope_data.mjs + extract_skill_map_scores.mjs
// as the canonical generator for all 4 scores (healScore's own formula already
// handled gap size correctly via gap_score, so it keeps that shape unchanged).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAP_ROOT = "G:\\git-clones\\Cosmic\\wz\\Map.wz\\Map";
const SCORES_PATH = path.join(__dirname, "..", "public", "data", "mapScores.js");

// MC_RANGE_PX: Magic Claw's actual horizontal reach, user-verified in-client at
// 300px (previously 425px, an unverified guess carried over from analyze_maps.py).
const MC_RANGE_PX = 300, MELEE_RANGE_PX = 150;
const AOE_RANGE_PX = 180;          // avg horizontal AoE clump radius, see extract_skill_map_scores.mjs
const AOE_VERTICAL_REACH_PX = 100; // avg vertical AoE box half-height, see the same skills' lt/rb data
const GAP_REFERENCE_PX = 350;      // gap size at which a floor-hop costs the old full 0.4 tedium unit
const FLAT_TOL_Y = 4, YBAND_MERGE_GAP = 15, XGAP_MERGE = 60, MIN_PLATFORM_LEN = 20;
const HEAL_GAP_SATURATE = 400, FLOOR_BONUS_SATURATE = 5;

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function attr(line, name) { const m = line.match(new RegExp(`name="${name}"[^>]*value="(-?[0-9.]+)"`)); return m ? Number(m[1]) : null; }
function strAttr(line, name) { const m = line.match(new RegExp(`name="${name}"[^>]*value="([^"]*)"`)); return m ? m[1] : null; }

function extractBlock(lines, startIdx) {
  let depth = 0;
  for (let i = startIdx; i < lines.length; i++) {
    const isOpen = /<imgdir /.test(lines[i]) && !lines[i].includes("/>");
    const isClose = /<\/imgdir>/.test(lines[i]);
    if (isOpen) depth++;
    if (isClose) { depth--; if (depth === 0) return [lines.slice(startIdx, i + 1), i]; }
  }
  return [lines.slice(startIdx), lines.length - 1];
}
function findChildBlock(lines, name) {
  const idx = lines.findIndex(l => new RegExp(`<imgdir name="${name}">`).test(l));
  if (idx === -1) return null;
  return extractBlock(lines, idx)[0];
}

function collectFootholds(fhBlock) {
  const segs = []; let cur = null;
  for (const line of fhBlock) {
    if (/<imgdir name="\d+">/.test(line)) {
      if (cur && cur.x1 !== null && cur.y1 !== null && cur.x2 !== null && cur.y2 !== null) segs.push([cur.x1, cur.y1, cur.x2, cur.y2]);
      cur = { x1: null, y1: null, x2: null, y2: null };
    } else if (cur) {
      if (line.includes('name="x1"')) cur.x1 = attr(line, "x1");
      else if (line.includes('name="y1"')) cur.y1 = attr(line, "y1");
      else if (line.includes('name="x2"')) cur.x2 = attr(line, "x2");
      else if (line.includes('name="y2"')) cur.y2 = attr(line, "y2");
    }
  }
  if (cur && cur.x1 !== null && cur.y1 !== null && cur.x2 !== null && cur.y2 !== null) segs.push([cur.x1, cur.y1, cur.x2, cur.y2]);
  return segs;
}
function collectMobs(lifeBlock) {
  const mobs = []; let cur = null;
  for (const line of lifeBlock) {
    if (/<imgdir name="[^"]+">/.test(line) && !/name="(x|y|cy|fh|f|hide|info|type|id)"/.test(line)) {
      if (cur && cur.type === "m" && cur.x !== null && (cur.cy !== null || cur.y !== null)) mobs.push({ x: cur.x, cy: cur.cy !== null ? cur.cy : cur.y });
      cur = { type: null, x: null, y: null, cy: null };
    } else if (cur) {
      if (line.includes('name="type"')) cur.type = strAttr(line, "type");
      else if (line.includes('name="x"')) cur.x = attr(line, "x");
      else if (line.includes('name="cy"')) cur.cy = attr(line, "cy");
      else if (line.includes('name="y"')) cur.y = attr(line, "y");
    }
  }
  if (cur && cur.type === "m" && cur.x !== null && (cur.cy !== null || cur.y !== null)) mobs.push({ x: cur.x, cy: cur.cy !== null ? cur.cy : cur.y });
  return mobs;
}
function collectRopes(ropeBlock) {
  if (!ropeBlock) return [];
  const ropes = []; let cur = null;
  for (const line of ropeBlock) {
    if (/<imgdir name="\d+">/.test(line)) {
      if (cur && cur.x !== null && cur.y1 !== null && cur.y2 !== null) ropes.push([cur.x, cur.y1, cur.y2]);
      cur = { x: null, y1: null, y2: null };
    } else if (cur) {
      if (line.includes('name="x"')) cur.x = attr(line, "x");
      else if (line.includes('name="y1"')) cur.y1 = attr(line, "y1");
      else if (line.includes('name="y2"')) cur.y2 = attr(line, "y2");
    }
  }
  if (cur && cur.x !== null && cur.y1 !== null && cur.y2 !== null) ropes.push([cur.x, cur.y1, cur.y2]);
  return ropes;
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
      if (Math.abs(y - b.yMean) <= YBAND_MERGE_GAP) { b.segs.push([xlo, xhi]); b.ys.push(y); b.yMean = b.ys.reduce((a, c) => a + c, 0) / b.ys.length; placed = true; break; }
    }
    if (!placed) bands.push({ yMean: y, ys: [y], segs: [[xlo, xhi]] });
  }
  bands.sort((a, b) => a.yMean - b.yMean);
  const mergedBands = [];
  for (const b of bands) {
    const last = mergedBands[mergedBands.length - 1];
    if (last && Math.abs(b.yMean - last.yMean) <= YBAND_MERGE_GAP) { last.segs.push(...b.segs); last.ys.push(...b.ys); last.yMean = last.ys.reduce((a, c) => a + c, 0) / last.ys.length; }
    else mergedBands.push(b);
  }
  const platforms = [];
  for (const b of mergedBands) {
    const segs = b.segs.slice().sort((a, c) => a[0] - c[0]);
    let [curLo, curHi] = segs[0];
    for (const [xlo, xhi] of segs.slice(1)) {
      if (xlo - curHi <= XGAP_MERGE) curHi = Math.max(curHi, xhi);
      else { if (curHi - curLo >= MIN_PLATFORM_LEN) platforms.push({ y: b.yMean, xmin: curLo, xmax: curHi, len: curHi - curLo }); [curLo, curHi] = [xlo, xhi]; }
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

// Per-gap tedium, summed across all adjacent-floor gaps -- see Bug 1 in header.
function gapAwareFloorPenalty(usedSortedByY) {
  if (usedSortedByY.length <= 1) return 1;
  let tedium = 0;
  for (let i = 0; i < usedSortedByY.length - 1; i++) {
    const gap = Math.abs(usedSortedByY[i + 1].y - usedSortedByY[i].y);
    tedium += clamp(gap / GAP_REFERENCE_PX, 0, 1) * 0.4;
  }
  return 1 / (1 + tedium);
}

function rangedOrMeleeScore(used, totalMobs, rangePx) {
  const nFloors = used.length;
  const avgLen = used.reduce((s, p) => s + p.len, 0) / nFloors;
  const lengthScore = clamp(avgLen / (rangePx * 2), 0, 1);
  const floorPenalty = gapAwareFloorPenalty(used.slice().sort((a, b) => a.y - b.y));
  const densityScore = clamp((totalMobs / nFloors) / 3, 0, 1);
  const raw = 0.45 * lengthScore + 0.35 * floorPenalty + 0.20 * densityScore;
  return clamp(Math.round(1 + raw * 4), 1, 5);
}

// aoeScore: clump window now also pulls in mobs from platforms within
// AOE_VERTICAL_REACH_PX -- see Bug 2 in header.
function aoeScore(used, mobs) {
  const nFloors = used.length;
  let bestClump = 0;
  for (const anchor of used) {
    const nearbyPlatforms = used.filter(p => Math.abs(p.y - anchor.y) <= AOE_VERTICAL_REACH_PX);
    const inReach = mobs.filter(m => nearbyPlatforms.some(p => p.xmin - 60 <= m.x && m.x <= p.xmax + 60 && Math.abs(m.cy - p.y) <= 60));
    if (!inReach.length) continue;
    const xs = inReach.map(m => m.x).sort((a, b) => a - b);
    let maxInWindow = 0;
    for (const cx of xs) {
      const inWindow = xs.filter(x => Math.abs(x - cx) <= AOE_RANGE_PX).length;
      if (inWindow > maxInWindow) maxInWindow = inWindow;
    }
    if (maxInWindow > bestClump) bestClump = maxInWindow;
  }
  const clumpScore = clamp(bestClump / 5, 0, 1);
  const floorPenalty = gapAwareFloorPenalty(used.slice().sort((a, b) => a.y - b.y));
  const raw = 0.55 * clumpScore + 0.45 * floorPenalty;
  return clamp(Math.round(1 + raw * 4), 1, 5);
}

function healScoreFn(used) {
  const nFloors = used.length;
  const ysSorted = [...new Set(used.map(p => Math.round(p.y)))].sort((a, b) => a - b);
  let avgGap;
  if (ysSorted.length >= 2) {
    const gaps = ysSorted.slice(1).map((y, i) => y - ysSorted[i]);
    avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  } else avgGap = HEAL_GAP_SATURATE;
  const gapScore = clamp(1 - avgGap / HEAL_GAP_SATURATE, 0, 1);
  const usedSorted = used.slice().sort((a, b) => a.y - b.y);
  const overlaps = [];
  for (let i = 0; i < usedSorted.length - 1; i++) {
    const a = usedSorted[i], b = usedSorted[i + 1];
    const ov = Math.max(0, Math.min(a.xmax, b.xmax) - Math.max(a.xmin, b.xmin));
    const denom = Math.min(a.len, b.len) || 1;
    overlaps.push(clamp(ov / denom, 0, 1));
  }
  const alignScore = overlaps.length ? overlaps.reduce((a, b) => a + b, 0) / overlaps.length : 0;
  const floorBonus = clamp(nFloors / FLOOR_BONUS_SATURATE, 0, 1);
  const raw = 0.45 * gapScore + 0.30 * alignScore + 0.25 * floorBonus;
  return clamp(Math.round(1 + raw * 4), 1, 5);
}

// Rope penalty with the same per-gap tightness discount as Bug 1/3 -- a rope
// spanning a 20px gap barely counts, one spanning 400px+ costs close to the old
// full penalty. Structurally the same shape as extract_rope_data.mjs's original
// (coverage ratio x floor factor x 3, gated on floors>=4 && ropes>=3) but the
// coverage ratio itself is now computed from tedium-weighted gaps, not raw px span.
function ropePenalty(usedSortedByY, footholdSpan, ropes, mobBearingFloors) {
  const qualifies = mobBearingFloors >= 4 && ropes.length >= 3;
  if (!qualifies || footholdSpan <= 0) return { penalty: 0, ropeCoverageRatio: 0 };
  let tedium = 0, maxTedium = 0;
  for (let i = 0; i < usedSortedByY.length - 1; i++) {
    const gap = Math.abs(usedSortedByY[i + 1].y - usedSortedByY[i].y);
    tedium += clamp(gap / GAP_REFERENCE_PX, 0, 1);
    maxTedium += 1;
  }
  const tightnessRatio = maxTedium > 0 ? tedium / maxTedium : 0; // 0=all tiny gaps, 1=all full-size+
  const ropeIntervals = ropes.map(([, y1, y2]) => [Math.min(y1, y2), Math.max(y1, y2)]);
  const merged = ropeIntervals.slice().sort((a, b) => a[0] - b[0]).reduce((acc, [lo, hi]) => {
    const last = acc[acc.length - 1];
    if (last && lo <= last[1]) last[1] = Math.max(last[1], hi);
    else acc.push([lo, hi]);
    return acc;
  }, []);
  const ropeUnionSpan = merged.reduce((s, [lo, hi]) => s + (hi - lo), 0);
  const ropeCoverageRatio = clamp(ropeUnionSpan / footholdSpan, 0, 1);
  const floorFactor = clamp(mobBearingFloors / 8, 0.3, 1);
  return { penalty: clamp(Math.round(ropeCoverageRatio * floorFactor * tightnessRatio * 3), 0, 3), ropeCoverageRatio };
}

function processFile(filePath, knownIds) {
  const mapId = Number(path.basename(filePath, ".img.xml"));
  if (!Number.isFinite(mapId) || !knownIds.has(mapId)) return null;

  const lines = fs.readFileSync(filePath, "utf8").split("\n");
  const fhBlock = findChildBlock(lines, "foothold");
  const lifeBlock = findChildBlock(lines, "life");
  const ropeIdx = lines.findIndex(l => /<imgdir name="ladderRope">/.test(l));
  const ropeBlock = ropeIdx !== -1 ? extractBlock(lines, ropeIdx)[0] : null;
  if (!fhBlock) return null;

  const footholds = collectFootholds(fhBlock);
  const mobs = lifeBlock ? collectMobs(lifeBlock) : [];
  const ropes = collectRopes(ropeBlock);
  const platforms = clusterPlatforms(footholds);
  assignMobsToPlatforms(platforms, mobs);

  let yMin = null, yMax = null;
  for (const [, y1, , y2] of footholds) {
    if (yMin === null || y1 < yMin) yMin = y1;
    if (yMax === null || y1 > yMax) yMax = y1;
    if (y2 < yMin) yMin = y2;
    if (y2 > yMax) yMax = y2;
  }
  const footholdSpan = (yMin !== null && yMax !== null) ? (yMax - yMin) : 0;

  const mobPlatforms = platforms.filter(p => p.mobCount > 0);
  const used = mobPlatforms.length ? mobPlatforms : platforms;
  if (!used.length) return null;
  const usedSortedByY = used.slice().sort((a, b) => a.y - b.y);

  const mcRaw = rangedOrMeleeScore(used, mobs.length, MC_RANGE_PX);
  const meleeRaw = rangedOrMeleeScore(used, mobs.length, MELEE_RANGE_PX);
  const aoeRaw = aoeScore(used, mobs);
  const healRaw = healScoreFn(used); // unchanged shape -- already gap-aware

  const { penalty: ropePen, ropeCoverageRatio } = ropePenalty(usedSortedByY, footholdSpan, ropes, used.length);

  return {
    mapId,
    platformCount: platforms.length,
    mobBearingFloors: used.length,
    avgPlatformLenPx: Math.round((used.reduce((s, p) => s + p.len, 0) / used.length) * 10) / 10,
    verticalSpanPx: Math.round(footholdSpan),
    mobCount: mobs.length,
    mcScoreRaw: mcRaw, meleeScoreRaw: meleeRaw, aoeScoreRaw: aoeRaw, healScoreRaw: healRaw,
    ropeCount: ropes.length, ropeCoverageRatio: Math.round(ropeCoverageRatio * 1000) / 1000,
    ropePenalty: ropePen,
  };
}

function main() {
  const src = fs.readFileSync(SCORES_PATH, "utf8");
  const jsonStart = src.indexOf("{");
  const jsonEnd = src.lastIndexOf("}") + 1;
  const scores = JSON.parse(src.slice(jsonStart, jsonEnd));
  const knownIds = new Set(Object.keys(scores).map(Number));

  // --dry-run <mapId>: print the recomputed scores for one map without writing --
  // used to validate a fix against a specific map (e.g. the Kerning Subway
  // Line 1 <Area 1> investigation) before trusting it on the full dataset.
  const dryRunIdx = process.argv.indexOf("--dry-run");
  if (dryRunIdx !== -1) {
    const targetId = Number(process.argv[dryRunIdx + 1]);
    for (const sub of fs.readdirSync(MAP_ROOT)) {
      const cand = path.join(MAP_ROOT, sub, `${targetId}.img.xml`);
      if (fs.existsSync(cand)) {
        console.log("BEFORE:", JSON.stringify(scores[targetId]));
        console.log("AFTER: ", JSON.stringify(processFile(cand, knownIds)));
        return;
      }
    }
    console.error("map file not found:", targetId);
    return;
  }

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
    // Preserve lowSpawnPenalty (a separate, still-valid concern -- see
    // apply_spawn_penalty.mjs) and reachable (extract_portals.mjs); only the
    // geometry-derived scores and rope penalty are being recomputed here.
    const lowSpawnPenalty = entry.lowSpawnPenalty || 0;
    entry.platformCount = r.platformCount;
    entry.mobBearingFloors = r.mobBearingFloors;
    entry.avgPlatformLenPx = r.avgPlatformLenPx;
    entry.verticalSpanPx = r.verticalSpanPx;
    entry.mobCount = r.mobCount;
    entry.ropeCount = r.ropeCount;
    entry.ropeCoverageRatio = r.ropeCoverageRatio;
    entry.mcScoreRaw = r.mcScoreRaw;
    entry.meleeScoreRaw = r.meleeScoreRaw;
    entry.aoeScoreRaw = r.aoeScoreRaw;
    entry.healScoreRaw = r.healScoreRaw;
    const totalPenalty = clamp(r.ropePenalty + lowSpawnPenalty, 0, 3);
    entry.mcScore = clamp(r.mcScoreRaw - totalPenalty, 1, 5);
    entry.meleeScore = clamp(r.meleeScoreRaw - totalPenalty, 1, 5);
    entry.aoeScore = clamp(r.aoeScoreRaw - totalPenalty, 1, 5);
    entry.healScore = clamp(r.healScoreRaw - Math.min(totalPenalty, 2), 1, 5);
  }
  console.error(`Done: ${processed} files scanned, ${matched} known maps matched`);

  const header = src.slice(0, jsonStart);
  fs.writeFileSync(SCORES_PATH, header + JSON.stringify(scores) + ";\n");
  console.error(`Wrote ${SCORES_PATH}`);
}

main();
