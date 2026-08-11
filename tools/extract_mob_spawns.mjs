// Parse every map .img.xml in Map.wz and extract mob-spawn (x,cy) coordinates
// plus the minimap's canvas transform (centerX/centerY/mag), so the app can
// plot spawn points as dots directly on the minimap thumbnail.
//
// Minimap pixel transform (standard MapleStory Map.wz convention):
//   pixelX = (worldX + centerX) / 2^mag
//   pixelY = (worldY + centerY) / 2^mag
//
// Output: public/data/mapMobSpawns.js -- window.MAP_MOB_SPAWNS[mapId] =
//   { mag, centerX, centerY, cw, ch, s: [[x,cy], ...] }
// Only maps that already have an entry in mapScores.js (hasMobs=true) are
// included, to keep the payload small.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAP_ROOT = "G:\\git-clones\\Cosmic\\wz\\Map.wz\\Map";
const SCORES_PATH = path.join(__dirname, "..", "public", "data", "mapScores.js");
const OUT_PATH = path.join(__dirname, "..", "public", "data", "mapMobSpawns.js");

function loadKnownMapIds() {
  const src = fs.readFileSync(SCORES_PATH, "utf8");
  const jsonStart = src.indexOf("{");
  const jsonEnd = src.lastIndexOf("}") + 1;
  const scores = JSON.parse(src.slice(jsonStart, jsonEnd));
  return new Set(Object.keys(scores).map(Number));
}

function attr(line, name) {
  const m = line.match(new RegExp(`name="${name}"[^>]*value="(-?[0-9.]+)"`));
  return m ? Number(m[1]) : null;
}

function walkDirs(files) {
  return files;
}

function parseFile(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  const lines = text.split("\n");

  // -- life/mob spawns --
  const spawns = [];
  let depth = 0;
  let inLife = false;
  let lifeDepth = 0;
  let curType = null, curX = null, curCy = null, curY = null;
  let inLifeChild = false;
  let lifeChildDepth = 0;

  for (const line of lines) {
    const isOpen = /<imgdir name=/.test(line) && !line.includes("/>");
    const isClose = /<\/imgdir>/.test(line);

    if (!inLife) {
      if (isOpen && /<imgdir name="life">/.test(line)) {
        inLife = true;
        lifeDepth = depth;
      }
      if (isOpen) depth++;
      if (isClose) depth--;
      continue;
    }

    // inside life
    if (!inLifeChild) {
      if (isOpen) {
        inLifeChild = true;
        lifeChildDepth = depth;
        curType = curX = curCy = curY = null;
        depth++;
      } else if (isClose) {
        depth--;
        if (depth === lifeDepth) inLife = false;
      }
      continue;
    }

    // inside a life child (one spawn entry)
    if (isOpen) {
      depth++;
      continue;
    }
    if (isClose) {
      depth--;
      if (depth === lifeChildDepth) {
        inLifeChild = false;
        if (curType === "m" && curX !== null) {
          spawns.push([curX, curCy !== null ? curCy : curY]);
        }
      }
      continue;
    }
    if (line.includes('name="type"')) {
      const m = line.match(/value="([a-zA-Z])"/);
      if (m) curType = m[1];
    } else if (line.includes('name="x"')) {
      curX = attr(line, "x");
    } else if (line.includes('name="cy"')) {
      curCy = attr(line, "cy");
    } else if (line.includes('name="y"')) {
      curY = attr(line, "y");
    }
  }

  // -- miniMap transform --
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

  return { spawns, mag, centerX, centerY, cw, ch };
}

function main() {
  const known = loadKnownMapIds();
  const files = [];
  for (const sub of fs.readdirSync(MAP_ROOT)) {
    const subPath = path.join(MAP_ROOT, sub);
    if (!fs.statSync(subPath).isDirectory()) continue;
    for (const f of fs.readdirSync(subPath)) {
      if (f.endsWith(".img.xml")) files.push(path.join(subPath, f));
    }
  }
  console.error(`Found ${files.length} map files`);

  const out = {};
  let done = 0, skipped = 0;
  for (const f of files) {
    const base = path.basename(f, ".img.xml");
    const mapId = Number(base);
    if (!Number.isFinite(mapId) || !known.has(mapId)) { skipped++; continue; }

    const { spawns, mag, centerX, centerY, cw, ch } = parseFile(f);
    if (!spawns.length || mag === null || centerX === null || centerY === null || !cw || !ch) {
      skipped++;
      continue;
    }
    out[mapId] = { mag, centerX, centerY, cw, ch, s: spawns };
    done++;
    if (done % 300 === 0) console.error(`  ${done} maps processed`);
  }
  console.error(`Done: ${done} maps written, ${skipped} skipped`);

  const body = "window.MAP_MOB_SPAWNS = " + JSON.stringify(out) + ";\n";
  const header = "// Auto-generated by tools/extract_mob_spawns.mjs from Map.wz life+miniMap data.\n" +
    "// Keyed by mapId. mag/centerX/centerY/cw/ch define the minimap pixel transform:\n" +
    "//   pixelX = (worldX + centerX) / 2^mag, pixelY = (worldY + centerY) / 2^mag\n" +
    "// 's' is the list of [worldX, worldCy] mob spawn points for that map.\n";
  fs.writeFileSync(OUT_PATH, header + body);
  console.error(`Wrote ${OUT_PATH}`);
}

main();
