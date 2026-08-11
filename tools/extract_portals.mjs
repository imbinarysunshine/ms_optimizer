// Parse every map .img.xml in Map.wz (not just mob-bearing ones -- the portal
// graph needs connector/hidden maps too) to build a directed portal graph, then
// BFS it from every town map to determine which maps are actually reachable
// through normal gameplay.
//
// Motivation: "Hidden Street" maps (850 of them) often have no minimap
// thumbnail and no resolved world-map spot, which looks like missing/junk
// data -- but spot-checking confirmed at least one (100000002, "Hidden
// Street: An Empty House") has a real inbound portal from Henesys town, so
// it IS reachable, just via a portal the game doesn't surface on the overview
// map. Portal presence/target is ground truth for reachability; thumbnail or
// world-map-spot presence is not.
//
// Output:
//   public/data/mapPortals.js -- window.MAP_PORTALS[mapId] = { mag, centerX,
//     centerY, cw, ch, p: [[x, y, targetMapId], ...] } for maps with both a
//     minimap transform and at least one real portal (targetMapId != self-loop
//     sentinel 999999999) -- drives the expanded map view's "Portals" overlay
//     and click-to-navigate.
//   Merges `reachable: true/false` into every existing public/data/mapScores.js
//   entry (BFS result), so it's just a matter of comparing to the mapId in that
//   dataset -- this script doesn't add mapScores.js entries, only annotates them.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAP_ROOT = "G:\\git-clones\\Cosmic\\wz\\Map.wz\\Map";
const SCORES_PATH = path.join(__dirname, "..", "public", "data", "mapScores.js");
const PORTALS_OUT_PATH = path.join(__dirname, "..", "public", "data", "mapPortals.js");
const NO_TARGET = 999999999;

function attr(line, name) {
  const m = line.match(new RegExp(`name="${name}"[^>]*value="(-?[0-9.]+)"`));
  return m ? Number(m[1]) : null;
}

function extractBlock(lines, startIdx) {
  let depth = 0;
  for (let i = startIdx; i < lines.length; i++) {
    const isOpen = /<imgdir /.test(lines[i]) && !lines[i].includes("/>");
    const isClose = /<\/imgdir>/.test(lines[i]);
    if (isOpen) depth++;
    if (isClose) {
      depth--;
      if (depth === 0) return lines.slice(startIdx, i + 1);
    }
  }
  return lines.slice(startIdx);
}

function parseFile(filePath) {
  const lines = fs.readFileSync(filePath, "utf8").split("\n");

  let isTown = false;
  const infoIdx = lines.findIndex(l => /<imgdir name="info">/.test(l));
  if (infoIdx !== -1) {
    const block = extractBlock(lines, infoIdx);
    isTown = block.some(l => /<int name="town" value="1"\/>/.test(l));
  }

  const portals = [];
  const portalIdx = lines.findIndex(l => /<imgdir name="portal">/.test(l));
  if (portalIdx !== -1) {
    const block = extractBlock(lines, portalIdx);
    let cur = null;
    for (const line of block) {
      if (/<imgdir name="\d+">/.test(line) && line !== block[0]) {
        cur = { x: null, y: null, tm: null };
      } else if (cur) {
        if (line.includes('name="x"')) cur.x = attr(line, "x");
        else if (line.includes('name="y"')) cur.y = attr(line, "y");
        else if (line.includes('name="tm"')) cur.tm = attr(line, "tm");
        else if (/<\/imgdir>/.test(line)) {
          if (cur.x !== null && cur.y !== null && cur.tm !== null) portals.push(cur);
          cur = null;
        }
      }
    }
  }

  let mag = null, centerX = null, centerY = null, cw = null, ch = null;
  const mmIdx = lines.findIndex(l => /<imgdir name="miniMap">/.test(l));
  if (mmIdx !== -1) {
    for (let i = mmIdx; i < Math.min(lines.length, mmIdx + 12); i++) {
      const l = lines[i];
      if (l.includes('name="canvas"')) {
        const w = l.match(/width="(\d+)"/);
        const h = l.match(/height="(\d+)"/);
        if (w) cw = Number(w[1]);
        if (h) ch = Number(h[1]);
      } else if (l.includes('name="centerX"')) centerX = attr(l, "centerX");
      else if (l.includes('name="centerY"')) centerY = attr(l, "centerY");
      else if (l.includes('name="mag"')) mag = attr(l, "mag");
      else if (/<\/imgdir>/.test(l) && i > mmIdx) break;
    }
  }

  return { isTown, portals, mag, centerX, centerY, cw, ch };
}

function main() {
  const files = [];
  for (const sub of fs.readdirSync(MAP_ROOT)) {
    const subPath = path.join(MAP_ROOT, sub);
    if (!fs.statSync(subPath).isDirectory()) continue;
    for (const f of fs.readdirSync(subPath)) {
      if (f.endsWith(".img.xml")) files.push(path.join(subPath, f));
    }
  }
  console.error(`Found ${files.length} map files`);

  const maps = new Map(); // mapId -> { isTown, portals, mag, centerX, centerY, cw, ch }
  let processed = 0;
  for (const f of files) {
    const mapId = Number(path.basename(f, ".img.xml"));
    if (!Number.isFinite(mapId)) continue;
    maps.set(mapId, parseFile(f));
    processed++;
    if (processed % 800 === 0) console.error(`  ${processed} parsed`);
  }
  console.error(`Parsed ${maps.size} maps`);

  // -- BFS reachability from every town map --
  const roots = [...maps.entries()].filter(([, m]) => m.isTown).map(([id]) => id);
  console.error(`${roots.length} town roots`);
  const reachable = new Set(roots);
  const queue = [...roots];
  while (queue.length) {
    const id = queue.pop();
    const m = maps.get(id);
    if (!m) continue;
    for (const p of m.portals) {
      if (p.tm === NO_TARGET) continue;
      if (!maps.has(p.tm)) continue; // target map doesn't actually exist in this export
      if (!reachable.has(p.tm)) {
        reachable.add(p.tm);
        queue.push(p.tm);
      }
    }
  }
  console.error(`${reachable.size}/${maps.size} maps reachable from town roots`);

  // -- merge `reachable` into mapScores.js --
  const src = fs.readFileSync(SCORES_PATH, "utf8");
  const jsonStart = src.indexOf("{");
  const jsonEnd = src.lastIndexOf("}") + 1;
  const scores = JSON.parse(src.slice(jsonStart, jsonEnd));
  let unreachableCount = 0;
  for (const [mapId, entry] of Object.entries(scores)) {
    entry.reachable = reachable.has(Number(mapId));
    if (!entry.reachable) unreachableCount++;
  }
  console.error(`${unreachableCount}/${Object.keys(scores).length} mapScores.js entries flagged unreachable`);
  const scoresHeader = "// Auto-generated from Map.wz foothold + mob-spawn geometry. See README.md for methodology.\n" +
    "// Keyed by mapId (number). Only includes maps with >=1 mob spawn (hasMobs=true).\n" +
    "// mcScore/healScore are travel- and spawn-supply-penalized (see tools/extract_rope_data.mjs\n" +
    "// and tools/apply_spawn_penalty.mjs); mcScoreRaw/healScoreRaw are the original\n" +
    "// geometry-only scores before either penalty. `reachable` is a portal-graph BFS\n" +
    "// result from every town map (see tools/extract_portals.mjs).\n";
  fs.writeFileSync(SCORES_PATH, scoresHeader + "window.MAP_SCORES = " + JSON.stringify(scores) + ";\n");
  console.error(`Wrote ${SCORES_PATH}`);

  // -- portal overlay data (only maps with a minimap transform + >=1 real portal) --
  const portalsOut = {};
  for (const [mapId, m] of maps) {
    const realPortals = m.portals.filter(p => p.tm !== NO_TARGET);
    if (!realPortals.length || m.mag === null || m.centerX === null || m.centerY === null || !m.cw || !m.ch) continue;
    portalsOut[mapId] = {
      mag: m.mag, centerX: m.centerX, centerY: m.centerY, cw: m.cw, ch: m.ch,
      p: realPortals.map(p => [p.x, p.y, p.tm]),
    };
  }
  console.error(`${Object.keys(portalsOut).length} maps with renderable portal overlays`);
  const portalsHeader = "// Auto-generated by tools/extract_portals.mjs from Map.wz portal + miniMap data.\n" +
    "// Keyed by mapId. mag/centerX/centerY/cw/ch define the minimap pixel transform (same\n" +
    "// convention as mapMobSpawns.js). 'p' is [worldX, worldY, targetMapId] per portal --\n" +
    "// drives the expanded map view's clickable Portals overlay.\n";
  fs.writeFileSync(PORTALS_OUT_PATH, portalsHeader + "window.MAP_PORTALS = " + JSON.stringify(portalsOut) + ";\n");
  console.error(`Wrote ${PORTALS_OUT_PATH}`);
}

main();
