// SUPERSEDED (score-penalty half only) by tools/recompute_map_scores.mjs -- see
// README.md "Map-quality scoring". The mapRopes.js output below (used by the
// "Ropes/Ladders" map overlay) is still current; only rope_analysis.json and the
// penalizedMcScore/penalizedHealScore fields it fed into merge_rope_penalty.mjs
// are superseded, by a gap-size-aware version of this same penalty.
//
// Parse every map .img.xml in Map.wz and extract ladderRope segments plus the
// full foothold vertical extent, to measure how "rope/ladder-reliant" a map
// is for getting between mob-bearing floors -- a form of tedium the original
// mcScore/healScore (analyze_maps.py) didn't capture, since it only scored
// platform length/alignment/floor-count and implicitly assumed floor-to-floor
// travel cost is uniform regardless of whether it's a jump or a slow rope climb.
//
// Investigated at the user's prompt after flagging map 107000500 (Dungeon:
// Damp Tree-Forest) as a 4/5 mcScore map that's actually tedious due to heavy
// rope use -- confirmed: 14 separate ladderRope segments there.
//
// Output: tools/rope_analysis.json -- per mapId: { ropeCount, ropeCoverageRatio,
//   footholdVerticalSpanPx, mcScore, healScore, penalizedMcScore, penalizedHealScore }
// Also public/data/mapRopes.js -- window.MAP_ROPES[mapId] = list of
//   [x, y1, y2] rope segments (world coords), for optional UI overlay.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAP_ROOT = "G:\\git-clones\\Cosmic\\wz\\Map.wz\\Map";
const SCORES_PATH = path.join(__dirname, "..", "public", "data", "mapScores.js");
const ROPES_OUT_PATH = path.join(__dirname, "..", "public", "data", "mapRopes.js");
const ANALYSIS_OUT_PATH = path.join(__dirname, "rope_analysis.json");

function loadScores() {
  const src = fs.readFileSync(SCORES_PATH, "utf8");
  const jsonStart = src.indexOf("{");
  const jsonEnd = src.lastIndexOf("}") + 1;
  return JSON.parse(src.slice(jsonStart, jsonEnd));
}

function attr(line, name) {
  const m = line.match(new RegExp(`name="${name}"[^>]*value="(-?[0-9.]+)"`));
  return m ? Number(m[1]) : null;
}

// Generic imgdir-block walker: given lines and the index of an opening
// "<imgdir name="X">" line, returns [blockLines, endIndex] for that subtree.
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

function parseFile(filePath) {
  const lines = fs.readFileSync(filePath, "utf8").split("\n");

  // -- ladderRope segments --
  const ropes = [];
  const ropeIdx = lines.findIndex(l => /<imgdir name="ladderRope">/.test(l));
  if (ropeIdx !== -1) {
    const [block] = extractBlock(lines, ropeIdx);
    let cur = null;
    for (const line of block) {
      if (/<imgdir name="\d+">/.test(line) && line !== block[0]) {
        cur = { x: null, y1: null, y2: null };
      } else if (cur) {
        if (line.includes('name="x"')) cur.x = attr(line, "x");
        else if (line.includes('name="y1"')) cur.y1 = attr(line, "y1");
        else if (line.includes('name="y2"')) cur.y2 = attr(line, "y2");
        else if (/<\/imgdir>/.test(line)) {
          if (cur.x !== null && cur.y1 !== null && cur.y2 !== null) ropes.push([cur.x, cur.y1, cur.y2]);
          cur = null;
        }
      }
    }
  }

  // -- full foothold vertical extent (all footholds, not just flat platforms) --
  let yMin = null, yMax = null;
  const fhIdx = lines.findIndex(l => /<imgdir name="foothold">/.test(l));
  if (fhIdx !== -1) {
    const [block] = extractBlock(lines, fhIdx);
    for (const line of block) {
      if (line.includes('name="y1"') || line.includes('name="y2"')) {
        const v = attr(line, line.includes('name="y1"') ? "y1" : "y2");
        if (v !== null) {
          if (yMin === null || v < yMin) yMin = v;
          if (yMax === null || v > yMax) yMax = v;
        }
      }
    }
  }

  return { ropes, yMin, yMax };
}

function mergeIntervals(intervals) {
  if (!intervals.length) return [];
  const sorted = intervals.slice().sort((a, b) => a[0] - b[0]);
  const merged = [sorted[0].slice()];
  for (const [lo, hi] of sorted.slice(1)) {
    const last = merged[merged.length - 1];
    if (lo <= last[1]) last[1] = Math.max(last[1], hi);
    else merged.push([lo, hi]);
  }
  return merged;
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function main() {
  const scores = loadScores();
  const knownIds = new Set(Object.keys(scores).map(Number));

  const files = [];
  for (const sub of fs.readdirSync(MAP_ROOT)) {
    const subPath = path.join(MAP_ROOT, sub);
    if (!fs.statSync(subPath).isDirectory()) continue;
    for (const f of fs.readdirSync(subPath)) {
      if (f.endsWith(".img.xml")) files.push(path.join(subPath, f));
    }
  }
  console.error(`Found ${files.length} map files`);

  const ropesOut = {};
  const analysis = {};
  let processed = 0;

  for (const f of files) {
    const mapId = Number(path.basename(f, ".img.xml"));
    if (!Number.isFinite(mapId) || !knownIds.has(mapId)) continue;

    const { ropes, yMin, yMax } = parseFile(f);
    const score = scores[mapId];

    const footholdSpan = (yMin !== null && yMax !== null) ? (yMax - yMin) : (score.verticalSpanPx || 0);
    const ropeIntervals = ropes.map(([, y1, y2]) => [Math.min(y1, y2), Math.max(y1, y2)]);
    const merged = mergeIntervals(ropeIntervals);
    const ropeUnionSpan = merged.reduce((s, [lo, hi]) => s + (hi - lo), 0);
    const ropeCoverageRatio = footholdSpan > 0 ? clamp(ropeUnionSpan / footholdSpan, 0, 1) : 0;

    // Penalty: rope-heavy vertical traversal is much slower than a jump between
    // adjacent platforms, so it directly undercuts both MC (repositioning between
    // farming floors) and Heal (repositioning as floors clear) efficiency.
    // Scaled by both coverage ratio (how much of the map's height needs ropes)
    // and floor count (more mob-bearing floors -> more forced rope transitions,
    // saturating at 8 floors so 5-6 floor maps don't immediately max out).
    // Gated to maps with a real farm-hopping shape (>=4 mob-bearing floors,
    // >=3 rope segments) -- a single portal-access rope on an otherwise flat
    // 1-2 floor map (e.g. Kerning Square rooms, the tutorial camp) isn't the
    // "particularly tedious" pattern this was built to catch.
    const floors = score.mobBearingFloors || 1;
    const qualifies = floors >= 4 && ropes.length >= 3;
    const floorFactor = clamp(floors / 8, 0.3, 1);
    const penalty = qualifies ? clamp(Math.round(ropeCoverageRatio * floorFactor * 3), 0, 3) : 0;

    if (ropes.length > 0) {
      ropesOut[mapId] = ropes;
    }
    analysis[mapId] = {
      ropeCount: ropes.length,
      ropeCoverageRatio: Math.round(ropeCoverageRatio * 1000) / 1000,
      footholdVerticalSpanPx: Math.round(footholdSpan),
      mobBearingFloors: score.mobBearingFloors,
      mcScore: score.mcScore,
      healScore: score.healScore,
      penalizedMcScore: clamp(score.mcScore - penalty, 1, 5),
      penalizedHealScore: clamp(score.healScore - Math.min(penalty, 2), 1, 5),
      penalty,
    };
    processed++;
    if (processed % 300 === 0) console.error(`  ${processed} processed`);
  }
  console.error(`Done: ${processed} maps analyzed`);

  fs.writeFileSync(ANALYSIS_OUT_PATH, JSON.stringify(analysis));
  console.error(`Wrote ${ANALYSIS_OUT_PATH}`);

  const header = "// Auto-generated by tools/extract_rope_data.mjs from Map.wz ladderRope data.\n" +
    "// Keyed by mapId. Each entry is a list of [x, y1, y2] rope/ladder segments (world coords).\n";
  fs.writeFileSync(ROPES_OUT_PATH, header + "window.MAP_ROPES = " + JSON.stringify(ropesOut) + ";\n");
  console.error(`Wrote ${ROPES_OUT_PATH}`);
}

main();
