// Compute a real per-monster mesos/kill income figure from Cosmic's actual
// drop tables + Item.wz/Character.wz NPC sell prices, replacing the flat
// INCOME_PER_KILL=357 constant that was applied to every single monster in
// App.jsx regardless of level or drop table (Snail and a level-80 boss were
// both treated as worth exactly the same per kill).
//
// Drop tables + item prices (Cosmic private-server repo, github.com/ronancpl/Cosmic
// -- a v83+ reimplementation whose data.sql drop tables and Item.wz price fields
// track real, era-appropriate NPC sell values; the project's own known-good WZ
// extracts have no Item.wz/drop tables at all, since real MapleStory clients never
// ship that server-authoritative data -- see maplestory_source_wz_extracts.zip's
// README "v62_wz.zip" dead-end note):
//   src/main/resources/db/data/152-drop-data.sql  (dropperid -> itemid/qty/chance)
//   wz/Character.wz/<8-digit-id>.img.xml            (Equip items, itemid prefix 1)
//   wz/Item.wz/Consume|Install|Etc|Cash/<id>.img.xml (non-equip, prefix 2-5)
//
// Monster id crosswalk (tools/.wz_cache/String_Mob_wz, extracted from the project's
// known-good maplestory_source_wz_extracts.zip -- same source as build_mobwz_crosswalk.py):
// MONSTER_DB's `id` field is the real Mob.wz catalog id for the ~1,032 "auto:true"
// entries pulled straight from the Cosmic dump, but NOT for the ~105 hand-curated
// meowdb-sourced entries (Snail id:2, Mano id:700004, etc. -- meowdb's own display
// ids, not catalog ids). Those are crosswalked to a real catalog id by name+level
// match (±6 levels) against Mob.wz info/level + String.wz/Mob.img.xml name, exactly
// like build_mobwz_crosswalk.py's stat-correction pass -- so drop_data lookups work
// for the low-level monsters this app's early-game leveling advice most needs.
//
// Methodology: for each monster id in MONSTER_DB, sum:
//   mesosEV  = sum over itemid=0 rows of (chance/999999) * avg(minQty,maxQty)
//   itemsEV  = sum over itemid!=0, questid=0 rows of (chance/999999) * avg(minQty,maxQty) * sellPrice(itemid)
//     (questid!=0 rows are quest-only guaranteed items, not sellable/farmable income -- excluded)
//     (items with no info/price node, i.e. unsellable -- e.g. quest turn-ins, cash items -- contribute 0)
// incomePerKill = mesosEV + itemsEV
//
// Output: src/data/mobDrops.js -- export const MOB_INCOME_PER_KILL = { [mobId]: mesos }
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COSMIC_ROOT = "G:\\git-clones\\Cosmic";
const DROP_SQL = path.join(COSMIC_ROOT, "src", "main", "resources", "db", "data", "152-drop-data.sql");
const CHAR_WZ = path.join(COSMIC_ROOT, "wz", "Character.wz");
const ITEM_WZ = path.join(COSMIC_ROOT, "wz", "Item.wz");
const WZ_CACHE = path.join(__dirname, ".wz_cache", "String_Mob_wz");
const MOB_WZ_KNOWNGOOD = path.join(WZ_CACHE, "Mob.wz");
const MOB_NAMES_PATH = path.join(WZ_CACHE, "String.wz", "Mob.img.xml");
const MONSTER_DB_PATH = path.join(__dirname, "..", "src", "data", "monsterDb.js");
const OUT_PATH = path.join(__dirname, "..", "src", "data", "mobDrops.js");

function loadMonsterEntries() {
  const src = fs.readFileSync(MONSTER_DB_PATH, "utf8");
  const entries = [];
  const re = /\{\s*id:(\d+),\s*name:"([^"]+)",\s*level:(\d+)[^}]*?(auto:true)?\s*\}/g;
  let m;
  while ((m = re.exec(src))) {
    entries.push({ id: Number(m[1]), name: m[2], level: Number(m[3]), auto: !!m[4] });
  }
  return entries;
}

// -- Real catalog id + level, from the known-good extract (not the live Cosmic clone) --
function loadCatalogNamesAndLevels() {
  const nameText = fs.readFileSync(MOB_NAMES_PATH, "utf8");
  const names = new Map(); // catalogId -> name
  const nameRe = /<imgdir name="(\d+)">\s*<string name="name" value="([^"]*)"\/>/g;
  let m;
  while ((m = nameRe.exec(nameText))) names.set(Number(m[1]), m[2]);

  const levels = new Map(); // catalogId -> level
  for (const f of fs.readdirSync(MOB_WZ_KNOWNGOOD)) {
    if (!f.endsWith(".img.xml")) continue;
    const catalogId = Number(f.replace(".img.xml", ""));
    const text = fs.readFileSync(path.join(MOB_WZ_KNOWNGOOD, f), "utf8");
    const lm = text.match(/<int name="level" value="(\d+)"\/>/);
    if (lm) levels.set(catalogId, Number(lm[1]));
  }
  return { names, levels };
}

function parseDropSql(catalogIds) {
  const text = fs.readFileSync(DROP_SQL, "utf8");
  const rows = [];
  const tupleRe = /\((\d+),\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+)\)/g;
  let m;
  while ((m = tupleRe.exec(text))) {
    const dropperid = Number(m[1]);
    if (catalogIds && !catalogIds.has(dropperid)) continue;
    rows.push({
      dropperid,
      itemid: Number(m[2]),
      minQty: Number(m[3]),
      maxQty: Number(m[4]),
      questid: Number(m[5]),
      chance: Number(m[6]),
    });
  }
  return rows;
}

// -- drop_data row counts per catalog id, used only as a crosswalk tie-break (see below) --
function loadDropRowCounts() {
  const counts = new Map(); // catalogId -> { rows, hasMesos }
  for (const r of parseDropSql(null)) {
    const c = counts.get(r.dropperid) || { rows: 0, hasMesos: false };
    c.rows++;
    if (r.itemid === 0) c.hasMesos = true;
    counts.set(r.dropperid, c);
  }
  return counts;
}

// Crosswalk MONSTER_DB's curated (non-catalog) ids to a real Mob.wz catalog id by
// exact name match + level within +/-6 (mirrors build_mobwz_crosswalk.py's tolerance).
// MapleStory frequently has multiple catalog ids for the same visual monster with
// identical name+level+stats (regular spawn vs. party-quest/event reskins, e.g. Mano
// has both a normal Beach III version and a Halloween-candy-drop event variant, both
// level 20) -- stats don't disambiguate them, but drop tables do, so ties are broken
// by preferring the candidate with a mesos drop row (the strongest signal of "this is
// the ordinary farmable version," since event/joke reskins usually only drop novelty
// items), then by total drop row count, then lowest catalog id for determinism.
function buildIdCrosswalk(entries) {
  const { names, levels } = loadCatalogNamesAndLevels();
  const dropCounts = loadDropRowCounts();
  const byName = new Map(); // name -> [catalogId, ...]
  for (const [id, name] of names) {
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(id);
  }

  const crosswalk = new Map(); // MONSTER_DB id -> real catalog id
  let matched = 0, unmatched = 0;
  for (const e of entries) {
    if (e.auto) { crosswalk.set(e.id, e.id); continue; } // already a real catalog id
    const candidates = byName.get(e.name) || [];
    let bestDiff = Infinity;
    for (const cid of candidates) {
      const lvl = levels.get(cid);
      if (lvl === undefined) continue;
      const diff = Math.abs(lvl - e.level);
      if (diff <= 6 && diff < bestDiff) bestDiff = diff;
    }
    const tied = candidates.filter(cid => {
      const lvl = levels.get(cid);
      return lvl !== undefined && Math.abs(lvl - e.level) === bestDiff;
    });
    tied.sort((a, b) => {
      const da = dropCounts.get(a) || { rows: 0, hasMesos: false };
      const db = dropCounts.get(b) || { rows: 0, hasMesos: false };
      if (da.hasMesos !== db.hasMesos) return da.hasMesos ? -1 : 1;
      if (da.rows !== db.rows) return db.rows - da.rows;
      return a - b;
    });
    if (tied.length > 0) { crosswalk.set(e.id, tied[0]); matched++; }
    else unmatched++;
  }
  console.error(`Crosswalked ${matched} curated MONSTER_DB ids to real catalog ids (${unmatched} unresolved)`);
  return crosswalk;
}

// -- Item.wz / Character.wz price lookups --
// Character.wz is one file per equip item, but split across type subfolders
// (Weapon, Cap, Coat, ...) -- build a filename index by walking it once.
// Item.wz's non-equip categories instead bundle many items per file, keyed
// by the item id's first 4 digits (e.g. itemid 2000006 -> Consume/0200.img.xml
// containing an <imgdir name="02000006"> block per item) -- parse each bundle
// file once into an id->price map, cached by file path.
const priceCache = new Map();
const bundleCache = new Map();
let charFileIndex = null;

function buildCharFileIndex() {
  const index = new Map();
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".img.xml")) index.set(entry.name.replace(".img.xml", ""), full);
    }
  };
  walk(CHAR_WZ);
  return index;
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

function parseBundlePrices(filePath) {
  if (bundleCache.has(filePath)) return bundleCache.get(filePath);
  const prices = new Map();
  if (fs.existsSync(filePath)) {
    const lines = fs.readFileSync(filePath, "utf8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/<imgdir name="(\d{7,8})">/);
      if (!m) continue;
      const block = extractBlock(lines, i);
      for (const line of block) {
        const pm = line.match(/<int name="price"[^>]*value="(-?\d+)"/);
        if (pm) { prices.set(m[1], Number(pm[1])); break; }
      }
    }
  }
  bundleCache.set(filePath, prices);
  return prices;
}

function lookupPrice(itemId) {
  if (priceCache.has(itemId)) return priceCache.get(itemId);
  const idStr = String(itemId).padStart(8, "0");
  // Category digit is the 2nd char of the zero-padded 8-digit id, e.g. "02000006"
  // (Consume, category "2") or "01302000" (Equip, category "1") -- item ids are
  // conventionally <=7 raw digits, so padding always pushes the category digit
  // to index 1, not index 0.
  const prefix = idStr[1];
  let price = -1;

  if (prefix === "1") {
    if (!charFileIndex) charFileIndex = buildCharFileIndex();
    const fp = charFileIndex.get(idStr) || charFileIndex.get(String(itemId));
    if (fp) {
      const text = fs.readFileSync(fp, "utf8");
      const m = text.match(/<int name="price"[^>]*value="(-?\d+)"/);
      if (m) price = Number(m[1]);
    }
  } else {
    const category = { "2": "Consume", "3": "Install", "4": "Etc", "5": "Cash" }[prefix];
    if (category) {
      const bundleFile = path.join(ITEM_WZ, category, `${idStr.slice(0, 4)}.img.xml`);
      const prices = parseBundlePrices(bundleFile);
      if (prices.has(idStr)) price = prices.get(idStr);
    }
  }

  priceCache.set(itemId, price);
  return price;
}

function main() {
  const entries = loadMonsterEntries();
  console.error(`Loaded ${entries.length} monster entries from MONSTER_DB`);

  const crosswalk = buildIdCrosswalk(entries);
  const catalogIds = new Set(crosswalk.values());

  const rows = parseDropSql(catalogIds);
  console.error(`Matched ${rows.length} drop_data rows to crosswalked catalog ids`);

  const dropsByCatalogId = new Map();
  for (const r of rows) {
    if (!dropsByCatalogId.has(r.dropperid)) dropsByCatalogId.set(r.dropperid, []);
    dropsByCatalogId.get(r.dropperid).push(r);
  }

  const income = {};
  let priced = 0, unpriced = 0;
  for (const e of entries) {
    const catalogId = crosswalk.get(e.id);
    const dropRows = catalogId !== undefined ? dropsByCatalogId.get(catalogId) : undefined;
    if (!dropRows) continue;

    let ev = 0;
    for (const r of dropRows) {
      const rate = r.chance / 999999;
      const avgQty = (r.minQty + r.maxQty) / 2;
      if (r.itemid === 0) {
        ev += rate * avgQty; // mesos
        continue;
      }
      if (r.questid !== 0) continue; // quest-only guaranteed items aren't farmable income
      const price = lookupPrice(r.itemid);
      if (price > 0) {
        ev += rate * avgQty * price;
        priced++;
      } else {
        unpriced++;
      }
    }
    income[e.id] = Math.round(ev * 100) / 100;
  }
  console.error(`Priced ${priced} item-drop rows, ${unpriced} unsellable/unpriced (contribute 0)`);
  console.error(`Computed income for ${Object.keys(income).length}/${entries.length} monsters (rest have no drop_data rows -- see fallback in App.jsx)`);

  const header = "// Auto-generated by tools/extract_mob_drops.mjs from Cosmic's drop_data.sql + Item.wz/\n" +
    "// Character.wz NPC sell prices, crosswalked via the known-good String_Mob_wz extract.\n" +
    "// See that script's header comment for methodology.\n" +
    "// Keyed by monster id (matches MONSTER_DB's `id`). Value is expected mesos/kill\n" +
    "// (mesos drop EV + sellable item drop EV, quest-only drops excluded).\n" +
    "// Monsters absent here have no matching drop_data rows in the source dump --\n" +
    "// App.jsx falls back to the dataset-wide average for those.\n";
  fs.writeFileSync(OUT_PATH, header + "export const MOB_INCOME_PER_KILL = " + JSON.stringify(income) + ";\n");
  console.error(`Wrote ${OUT_PATH}`);
}

main();
