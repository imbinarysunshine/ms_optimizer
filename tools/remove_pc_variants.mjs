// One-off: removes the 18 "(PC)" PC-cafe-exclusive enhanced-rate monster variants
// (e.g. "Jr. Necki (PC)") from MONSTER_DB entirely -- confirmed not implemented on
// MapleLegends, so filtering them out at render time (the earlier "Hide PC-Cafe
// Mobs" chip) was a half-measure; they shouldn't be in the dataset at all.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONSTER_DB_PATH = path.join(__dirname, "..", "src", "data", "monsterDb.js");
const MOB_DROPS_PATH = path.join(__dirname, "..", "src", "data", "mobDrops.js");

const PC_VARIANT_IDS = [
  9300002, 9200000, 9200010, 9200006, 9200012, 9300000, 9200005, 9300001,
  9200009, 9200008, 9200003, 9200014, 9200007, 9200011, 9200002, 9200001,
  9200004, 9200013,
];
const pcSet = new Set(PC_VARIANT_IDS);

function removeFromIdSet(src, constName) {
  const re = new RegExp(`export const ${constName} = new Set\\(\\[([^\\]]*)\\]\\);`);
  const m = src.match(re);
  if (!m) throw new Error(`${constName} not found`);
  const existing = m[1].split(",").map(s => s.trim()).filter(Boolean).map(Number);
  const remaining = existing.filter(id => !pcSet.has(id));
  console.error(`${constName}: ${existing.length} -> ${remaining.length}`);
  return src.replace(m[0], `export const ${constName} = new Set([${remaining.join(",")}]);`);
}

let src = fs.readFileSync(MONSTER_DB_PATH, "utf8");
let removed = 0;

for (const id of PC_VARIANT_IDS) {
  const lineRe = new RegExp(`^ *\\{ id:${id},.*\\},?\\n`, "m");
  if (lineRe.test(src)) {
    src = src.replace(lineRe, "");
    removed++;
  } else {
    console.error(`WARN: id ${id} line not found`);
  }
}
console.error(`Removed ${removed}/${PC_VARIANT_IDS.length} PC-variant entries`);

// -- drop them from every id-keyed dataset that references MONSTER_DB ids: the two
// Sets in this file, plus MOB_INCOME_PER_KILL's object keys in the sibling module --
// otherwise those become dangling references to monsters that no longer exist.
src = removeFromIdSet(src, "STAT_VERIFIED_IDS");
src = removeFromIdSet(src, "UNDEAD_IDS");
fs.writeFileSync(MONSTER_DB_PATH, src);
console.error(`Wrote ${MONSTER_DB_PATH}`);

let dropsSrc = fs.readFileSync(MOB_DROPS_PATH, "utf8");
const dropsMatch = dropsSrc.match(/export const MOB_INCOME_PER_KILL = (\{.*\});/);
const drops = JSON.parse(dropsMatch[1]);
let removedDrops = 0;
for (const id of PC_VARIANT_IDS) {
  if (drops[id] !== undefined) { delete drops[id]; removedDrops++; }
}
console.error(`MOB_INCOME_PER_KILL: removed ${removedDrops} keys`);
dropsSrc = dropsSrc.replace(dropsMatch[0], "export const MOB_INCOME_PER_KILL = " + JSON.stringify(drops) + ";");
fs.writeFileSync(MOB_DROPS_PATH, dropsSrc);
console.error(`Wrote ${MOB_DROPS_PATH}`);
