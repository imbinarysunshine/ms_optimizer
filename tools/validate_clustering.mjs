// One-off: recompute mcScore/healScore with the SAME clustering logic
// extract_skill_map_scores.mjs uses, and diff against the existing (Python-derived)
// public/data/mapScores.js values -- a sanity check that the JS port of
// analyze_maps.py's platform-clustering is faithful before trusting the new
// meleeScore/aoeScore built on top of it.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAP_ROOT = "G:\\git-clones\\Cosmic\\wz\\Map.wz\\Map";
const SCORES_PATH = path.join(__dirname, "..", "public", "data", "mapScores.js");

const MC_RANGE_PX = 425, FLAT_TOL_Y = 4, YBAND_MERGE_GAP = 15, XGAP_MERGE = 60, MIN_PLATFORM_LEN = 20, HEAL_GAP_SATURATE = 400, FLOOR_BONUS_SATURATE = 5;
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
  const [block] = extractBlock(lines, idx);
  return block;
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
function scoreMap(used, totalMobs) {
  const nFloors = used.length;
  const avgLen = used.reduce((s, p) => s + p.len, 0) / nFloors;
  const lengthScore = clamp(avgLen / (MC_RANGE_PX * 2), 0, 1);
  const floorPenalty = 1 / (1 + Math.max(0, nFloors - 1) * 0.4);
  const densityScore = clamp((totalMobs / nFloors) / 3, 0, 1);
  const mcRaw = 0.45 * lengthScore + 0.35 * floorPenalty + 0.20 * densityScore;
  const mcScore = clamp(Math.round(1 + mcRaw * 4), 1, 5);

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
  const healRaw = 0.45 * gapScore + 0.30 * alignScore + 0.25 * floorBonus;
  const healScore = clamp(Math.round(1 + healRaw * 4), 1, 5);
  return { mcScore, healScore };
}

const src = fs.readFileSync(SCORES_PATH, "utf8");
const scores = JSON.parse(src.slice(src.indexOf("{"), src.lastIndexOf("}") + 1));
const sampleIds = Object.keys(scores).map(Number).filter(id => scores[id].hasMobs).sort(() => Math.random() - 0.5).slice(0, 60);

let matches = 0, mismatches = [];
for (const mapId of sampleIds) {
  // find the file
  let filePath = null;
  for (const sub of fs.readdirSync(MAP_ROOT)) {
    const cand = path.join(MAP_ROOT, sub, `${mapId}.img.xml`);
    if (fs.existsSync(cand)) { filePath = cand; break; }
  }
  if (!filePath) { console.log(mapId, "FILE NOT FOUND"); continue; }
  const lines = fs.readFileSync(filePath, "utf8").split("\n");
  const fhBlock = findChildBlock(lines, "foothold");
  const lifeBlock = findChildBlock(lines, "life");
  if (!fhBlock) { console.log(mapId, "NO FOOTHOLD"); continue; }
  const footholds = collectFootholds(fhBlock);
  const mobs = lifeBlock ? collectMobs(lifeBlock) : [];
  const platforms = clusterPlatforms(footholds);
  assignMobsToPlatforms(platforms, mobs);
  const mobPlatforms = platforms.filter(p => p.mobCount > 0);
  const used = mobPlatforms.length ? mobPlatforms : platforms;
  if (!used.length) { console.log(mapId, "NO USED PLATFORMS"); continue; }
  const { mcScore, healScore } = scoreMap(used, mobs.length);
  const expected = scores[mapId];
  const rawMc = expected.mcScoreRaw ?? expected.mcScore;
  const rawHeal = expected.healScoreRaw ?? expected.healScore;
  const ok = mcScore === rawMc && healScore === rawHeal;
  if (ok) matches++;
  else mismatches.push({ mapId, got: { mcScore, healScore }, expected: { mcScoreRaw: rawMc, healScoreRaw: rawHeal }, mobCountMine: mobs.length, mobCountExpected: expected.mobCount, platformCountMine: platforms.length, platformCountExpected: expected.platformCount });
}
console.log(`${matches}/${sampleIds.length} matched exactly`);
if (mismatches.length) {
  console.log("Mismatches:");
  for (const m of mismatches.slice(0, 15)) console.log(JSON.stringify(m));
}
