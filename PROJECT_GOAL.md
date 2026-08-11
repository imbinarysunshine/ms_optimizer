# Project Goal

**MapleStory Monster DB + Map Training Toolkit** — a React (Vite) web app that helps
a pre-Big Bang / classic MapleStory Magician (Magic Claw / Heal build) figure out
where to train efficiently.

## What it does

1. **Character stat modeling** — given a base character (level, INT, LUK, weapon
   matk, MP max), projects stats forward across levels (AP gain: +4 INT/+1 LUK per
   level) and computes Magic Claw and Heal damage using the pre-BB v62 skill formulas.
2. **Monster database** (`MONSTER_DB` in [src/App.jsx](src/App.jsx)) — hand-compiled
   HP/MP/EXP/ATK/DEF/acc/avoid/element data for ~100+ classic monsters, sourced from
   meowdb and cross-verified against a Cosmic v83 client dump (Mob.wz/String.wz) and
   spot-checked against MapleLegends' live values.
3. **Kill-math / efficiency**: for each monster, computes hits/casts-to-kill, MP
   cost, EXP-per-effort ratio, potion cost, and net mesos/EXP per training session
   for a selectable healing potion (Blue Potion, Mana Elixir, Elixir, Power Elixir).
4. **Map training scores** (`public/data/mapScores.js`) — precomputed per-map fit
   scores derived from actual Map.wz foothold/spawn geometry (1,892 maps), letting
   the UI rank/filter maps by how well they suit MC/Heal training.
5. **Map & world-map browsing UI** — minimap thumbnails (`public/data/thumbs/`),
   world-map overview images (`public/data/worldmaps/`), and monster sprites
   (`public/data/mobs/`) extracted from the game client, so results are visually
   tied to actual in-game maps/monsters.

## End goal

Let a player plug in their current character stats and instantly see: which
monsters/maps give the best EXP and mesos per hour for their Magic Claw/Heal
build, at their current level and as they level up — replacing manual
spreadsheet/wiki lookups with one interactive tool grounded in real game data.

## Architecture notes

- `src/App.jsx` — all app logic/UI (stat math, monster DB, damage formulas,
  session profit model, filters, map views). No TypeScript despite `.jsx` origin
  (`.tsx` renamed, never had real TS syntax).
- `public/data/*.js` — set `window.MAP_SCORES` / `MAP_NAMES` / `WORLD_MAP_DATA`
  as globals via `<script>` tags in `index.html` (legacy loading style, kept
  intentionally rather than converted to ES modules).
- `tools/` — Python/PowerShell scripts to regenerate `public/data/` from a
  fresh Map.wz/Mob.wz/WorldMap.wz client export (not run as part of normal dev).

See [README.md](README.md) for setup/run instructions.
