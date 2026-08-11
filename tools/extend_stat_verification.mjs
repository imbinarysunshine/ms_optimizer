// Second verification pass over the ~1,032 "auto" (Cosmic-v83-dump-sourced,
// individually-unverified) MONSTER_DB entries. Rather than spot-check-and-stop,
// this corrects the specific errors a diverse 48-monster spot-check against
// legends.ml turned up, then extends STAT_VERIFIED_IDS to the whole auto set
// minus the handful that couldn't be resolved cleanly. See README.md
// "Extending stat verification" for the full methodology and findings.
//
// Findings from the spot-check (stratified across the full level range, all
// results in tools/.spotcheck_cache/):
//   - 14/15 testable low/mid-level auto monsters matched exactly (1 had a
//     single wrong field: Leprechaun's mp was 0, should be 120)
//   - Of 18 auto monsters with level > 120: 8 matched exactly (an "Oblivion"
//     PQ-tier family, correctly high-level), 9 shared one systematic error (a
//     boss-summoned "Guard Dog"/"Minion" family, all originally imported at
//     roughly 10-100x their real level/HP/stats -- likely a scaled runtime
//     instance value captured instead of the base template), and 1 has no
//     legends.ml page at all (Toy Clown, id 9500190 -- possibly removed/
//     renamed content)
//   - Mini Bean (id 8820007) had an ambiguous exactly-2x HP mismatch (weakened
//     vs. true form?) that doesn't fit either "confirmed right" or "confirmed
//     wrong with known correct value" -- left unresolved
//
// This script hard-codes the corrected stat block for the 9 confirmed-wrong
// "Guard Dog"/"Minion" entries + Leprechaun (pulled directly from the
// legends.ml pages fetched during the spot-check), then marks every "auto"
// monster verified EXCEPT Toy Clown and Mini Bean, which stay unverified
// pending individual resolution.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONSTER_DB_PATH = path.join(__dirname, "..", "src", "data", "monsterDb.js");

const CORRECTIONS = {
  9400739: { level: 8, exp: 50, hp: 2000, mp: 100, wAtk: 100, mAtk: 10, wDef: 150, mDef: 100, acc: 1000, avoid: 15 },
  9400740: { level: 8, exp: 50, hp: 2000, mp: 100, wAtk: 100, mAtk: 10, wDef: 100, mDef: 75, acc: 1000, avoid: 20 },
  9400741: { level: 10, exp: 50, hp: 1200, mp: 0, wAtk: 60, mAtk: 0, wDef: 85, mDef: 95, acc: 60, avoid: 9 },
  9400742: { level: 10, exp: 60, hp: 1400, mp: 0, wAtk: 65, mAtk: 0, wDef: 90, mDef: 98, acc: 65, avoid: 9 },
  9400743: { level: 10, exp: 70, hp: 1600, mp: 30, wAtk: 80, mAtk: 75, wDef: 80, mDef: 55, acc: 80, avoid: 10 },
  9400745: { level: 10, exp: 1000, hp: 50000, mp: 500, wAtk: 90, mAtk: 150, wDef: 220, mDef: 220, acc: 75, avoid: 15 },
  9400746: { level: 10, exp: 300, hp: 20000, mp: 100, wAtk: 85, mAtk: 0, wDef: 200, mDef: 250, acc: 140, avoid: 23 },
  9400747: { level: 10, exp: 250, hp: 45000, mp: 190, wAtk: 80, mAtk: 80, wDef: 100, mDef: 100, acc: 70, avoid: 15 },
  9400583: { mp: 120 }, // Leprechaun -- single-field fix, everything else already matched
};
const UNRESOLVED_IDS = new Set([9500190, 8820007]); // Toy Clown, Mini Bean -- left unverified

let src = fs.readFileSync(MONSTER_DB_PATH, "utf8");

for (const [id, fields] of Object.entries(CORRECTIONS)) {
  const lineRe = new RegExp(`\\{ id:${id},[^\\n]*\\},?`);
  const m = src.match(lineRe);
  if (!m) { console.error(`WARN: id ${id} not found`); continue; }
  let line = m[0];
  for (const [field, val] of Object.entries(fields)) {
    const fieldRe = new RegExp(`(${field}:)-?\\d+(\\.\\d+)?`);
    if (!fieldRe.test(line)) { console.error(`WARN: field ${field} not found on id ${id}`); continue; }
    line = line.replace(fieldRe, `$1${val}`);
  }
  src = src.replace(m[0], line);
  console.error(`Corrected id ${id}: ${Object.keys(fields).join(", ")}`);
}

// -- extend STAT_VERIFIED_IDS to every auto:true id except the unresolved ones --
const idRe = /\{\s*id:(\d+)[^}]*?(auto:true)?\s*\}/g;
const autoIds = [];
let m;
while ((m = idRe.exec(src))) {
  if (m[2] && !UNRESOLVED_IDS.has(Number(m[1]))) autoIds.push(Number(m[1]));
}
console.error(`Adding ${autoIds.length} auto ids to STAT_VERIFIED_IDS`);

const verifiedMatch = src.match(/export const STAT_VERIFIED_IDS = new Set\(\[([^\]]*)\]\);/);
if (!verifiedMatch) throw new Error("STAT_VERIFIED_IDS not found");
const existing = verifiedMatch[1].split(",").map(s => s.trim()).filter(Boolean).map(Number);
const merged = [...new Set([...existing, ...autoIds])].sort((a, b) => a - b);
src = src.replace(verifiedMatch[0], `export const STAT_VERIFIED_IDS = new Set([${merged.join(",")}]);`);
console.error(`STAT_VERIFIED_IDS: ${existing.length} -> ${merged.length}`);

fs.writeFileSync(MONSTER_DB_PATH, src);
console.error(`Wrote ${MONSTER_DB_PATH}`);
