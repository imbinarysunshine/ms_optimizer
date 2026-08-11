// Merge tools/rope_analysis.json (produced by extract_rope_data.mjs) into
// public/data/mapScores.js: keeps the original geometry-only mcScore/healScore
// as mcScoreRaw/healScoreRaw, and overwrites mcScore/healScore with the
// rope/ladder-travel-penalized values so the app's displayed score reflects
// real traversal tedium (see README.md "Rope/ladder travel penalty").
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCORES_PATH = path.join(__dirname, "..", "public", "data", "mapScores.js");
const ANALYSIS_PATH = path.join(__dirname, "rope_analysis.json");

const src = fs.readFileSync(SCORES_PATH, "utf8");
const jsonStart = src.indexOf("{");
const jsonEnd = src.lastIndexOf("}") + 1;
const scores = JSON.parse(src.slice(jsonStart, jsonEnd));
const analysis = JSON.parse(fs.readFileSync(ANALYSIS_PATH, "utf8"));

let changed = 0;
for (const [mapId, entry] of Object.entries(scores)) {
  const a = analysis[mapId];
  if (!a) continue;
  entry.mcScoreRaw = entry.mcScore;
  entry.healScoreRaw = entry.healScore;
  entry.ropeCount = a.ropeCount;
  entry.ropeCoverageRatio = a.ropeCoverageRatio;
  if (a.penalty > 0) {
    entry.mcScore = a.penalizedMcScore;
    entry.healScore = a.penalizedHealScore;
    changed++;
  }
}
console.error(`Applied rope penalty to ${changed} maps`);

const header = "// Auto-generated from Map.wz foothold + mob-spawn geometry. See README.md for methodology.\n" +
  "// Keyed by mapId (number). Only includes maps with >=1 mob spawn (hasMobs=true).\n" +
  "// mcScore/healScore are travel-penalized (see tools/extract_rope_data.mjs); mcScoreRaw/\n" +
  "// healScoreRaw are the original geometry-only scores before the rope/ladder penalty.\n";
fs.writeFileSync(SCORES_PATH, header + "window.MAP_SCORES = " + JSON.stringify(scores) + ";\n");
console.error(`Wrote ${SCORES_PATH}`);
