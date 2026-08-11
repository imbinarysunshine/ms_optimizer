// Penalize map mcScore/healScore for low total spawn capacity (mapScores.js's
// existing `mobCount` field -- total simultaneous mob spawn points on the map,
// from Map.wz life data, already extracted by analyze_maps.py).
//
// A map can have great platform geometry (long flat platforms, tight floor
// alignment) and still be a poor sustained-farming spot if it simply doesn't
// have many monsters on it: a player clears the whole population faster than
// it respawns and sits idle waiting, which the original geometry-only score
// (and the rope/ladder travel penalty layered on top of it) never accounted
// for. High-mobCount maps have the opposite property -- there's always another
// spawn point active somewhere, so a full clear before respawn is unlikely.
//
// Penalty (0-3, subtracted from the CURRENT mcScore/healScore -- i.e. after the
// rope/ladder penalty from merge_rope_penalty.mjs, since both are independent,
// additive sources of real-world grinding downtime):
//   mobCount >= SATURATE (20): no penalty, ample supply
//   mobCount <= FLOOR (3): max penalty (3), severe risk of clearing the map empty
//   in between: linear interpolation, rounded
//
// Run after merge_rope_penalty.mjs (or on a mapScores.js that already has
// mcScoreRaw/healScoreRaw from it) -- mcScoreRaw/healScoreRaw are left
// untouched (still the pure geometry-only score), only the displayed
// mcScore/healScore are adjusted further.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCORES_PATH = path.join(__dirname, "..", "public", "data", "mapScores.js");

const SATURATE = 20;
const FLOOR = 3;

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function spawnPenalty(mobCount) {
  if (mobCount >= SATURATE) return 0;
  if (mobCount <= FLOOR) return 3;
  return clamp(Math.round(3 * (SATURATE - mobCount) / (SATURATE - FLOOR)), 0, 3);
}

function main() {
  const src = fs.readFileSync(SCORES_PATH, "utf8");
  const jsonStart = src.indexOf("{");
  const jsonEnd = src.lastIndexOf("}") + 1;
  const scores = JSON.parse(src.slice(jsonStart, jsonEnd));

  let changed = 0;
  const dist = {};
  for (const entry of Object.values(scores)) {
    const penalty = spawnPenalty(entry.mobCount);
    dist[penalty] = (dist[penalty] || 0) + 1;
    if (penalty === 0) continue;
    entry.lowSpawnPenalty = penalty;
    entry.mcScore = clamp(entry.mcScore - penalty, 1, 5);
    entry.healScore = clamp(entry.healScore - penalty, 1, 5);
    changed++;
  }
  console.error(`Penalty distribution: ${JSON.stringify(dist)}`);
  console.error(`Applied low-spawn penalty to ${changed} maps`);

  const header = "// Auto-generated from Map.wz foothold + mob-spawn geometry. See README.md for methodology.\n" +
    "// Keyed by mapId (number). Only includes maps with >=1 mob spawn (hasMobs=true).\n" +
    "// mcScore/healScore are travel- and spawn-supply-penalized (see tools/extract_rope_data.mjs\n" +
    "// and tools/apply_spawn_penalty.mjs); mcScoreRaw/healScoreRaw are the original\n" +
    "// geometry-only scores before either penalty.\n";
  fs.writeFileSync(SCORES_PATH, header + "window.MAP_SCORES = " + JSON.stringify(scores) + ";\n");
  console.error(`Wrote ${SCORES_PATH}`);
}

main();
