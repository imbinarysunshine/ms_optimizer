# MapleStory Monster DB + Map Training Toolkit

A React app for evaluating MapleStory training spots: monster stats, Magic
Claw / Heal damage and cast-to-kill math, per-monster session profit
(mesos, potion cost, EXP/levels gained) with a selectable potion (Blue
Potion, Mana Elixir, Elixir, Power Elixir), and per-map training scores
derived from Map.wz foothold/spawn geometry.

## Project layout

```
index.html          Vite entry point
vite.config.js       Vite + React plugin config
package.json
src/
  main.jsx           React 18 mount point
  App.jsx            The app itself (damage formulas, session profit model,
                      filters, map/world-map views)
  data/
    monsterDb.js       MONSTER_DB, STAT_VERIFIED_IDS, UNDEAD_IDS -- the
                        hand-compiled monster stat table (~1,140 monsters)
    expTable.js         EXP_TABLE -- EXP-to-next-level by character level
    mobDrops.js          MOB_INCOME_PER_KILL -- real per-monster mesos/kill
                          income (mesos + sellable item/equip drop EV), keyed
                          by MONSTER_DB id
public/data/
  mapScores.js        window.MAP_SCORES -- Map.wz-derived MC/Heal training
                       fit scores for 1,892 maps
  mapNames.js         window.MAP_NAMES -- mapId -> display name
  worldMapData.js      window.WORLD_MAP_DATA -- mapId -> world-map spot
                       coordinates + per-region image dimensions
  mapMobSpawns.js      window.MAP_MOB_SPAWNS -- mapId -> minimap pixel
                       transform + mob spawn (x,cy) points, for the
                       "Mob Spawns" dot overlay in the expanded map view
  mapRopes.js          window.MAP_ROPES -- mapId -> list of [x,y1,y2]
                       rope/ladder segments (world coords), for the
                       "Ropes/Ladders" overlay in the expanded map view
  thumbs/<mapId>.png   Minimap thumbnails extracted from Map.wz
  worldmaps/<Region>.png  Regional world-map overview images from WorldMap.wz
  mobs/<catalogId>.png   Monster sprites extracted from Mob.wz
tools/
  analyze_maps.py           Regenerates the geometry-only mcScoreRaw/
                             healScoreRaw fields in mapScores.js from Map.wz
                             foothold/spawn data
  extract_mob_spawns.mjs    Regenerates mapMobSpawns.js from Map.wz life +
                             miniMap data (Node, no deps)
  extract_rope_data.mjs     Regenerates mapRopes.js and tools/rope_analysis.json
                             (gitignored, intermediate) from Map.wz ladderRope +
                             foothold data (Node, no deps)
  merge_rope_penalty.mjs    Applies rope_analysis.json's travel penalty on top
                             of mapScores.js's raw scores to produce the
                             displayed mcScore/healScore (Node, no deps)
  extract_mob_drops.mjs     Regenerates src/data/mobDrops.js from Cosmic's
                             drop_data.sql + Item.wz/Character.wz NPC sell
                             prices, crosswalked via tools/.wz_cache (Node, no deps)
  build_mobwz_crosswalk.py  Builds the monster ID crosswalk used to match
                             MONSTER_DB entries to Mob.wz sprites
  Flatten-MobThumbnails.ps1  Extracts/flattens Mob.wz sprite frames into
                             public/data/mobs/
  mobwz_verification_report.json  Output of the crosswalk verification pass
                                   (unresolved monster IDs, etc.)
```

## Running it

```
npm install
npm run dev
```

Then open the printed local URL. `npm run build` produces a static `dist/`
you can deploy or open directly.

## Why this structure

The original build was a single self-contained folder (`index.html` +
precompiled `app.js` + vendored React, no build step, double-click to run).
This version restructures the same app as a standard Vite + React project so
it's easy to keep developing with normal tooling (hot reload, npm deps,
source maps) instead of hand-editing compiled `React.createElement(...)`
output.

`src/App.jsx` is the same source that was previously named
`maplestory_monster_db_source.tsx` (it has no actual TypeScript syntax, just
`.tsx`/JSX, so it was renamed `.jsx` -- no type-checking is configured).
The ~1,140-entry `MONSTER_DB` array and `EXP_TABLE` originally lived inline
in `App.jsx` (pushing it past 2,400 lines); they've been split out into
`src/data/` as plain ES modules so the component/logic code is readable on
its own -- `App.jsx` imports them normally (`import { MONSTER_DB } from
"./data/monsterDb"`), unlike the `public/data/*.js` files below.

The `public/data/*.js` files still work the old way: they set `window.MAP_SCORES`,
`window.MAP_NAMES`, and `window.WORLD_MAP_DATA` as globals rather than ES
module exports, and `index.html` loads them via plain `<script>` tags before
mounting the app, exactly like the old bundle did. `App.jsx` references them
by their global names (e.g. `MAP_SCORES[mapId]`), so this wasn't changed.

## Regenerating data after a Map.wz/Mob.wz re-export

If more of Map.wz, WorldMap.wz, or Mob.wz gets exported later (to close gaps
on unresolved monsters or missing thumbnails), the scripts in `tools/` are
what regenerate `public/data/`:
- `analyze_maps.py` -> `mapScores.js` (mcScoreRaw/healScoreRaw + platform metrics)
- `extract_mob_spawns.mjs` -> `mapMobSpawns.js`
- `extract_rope_data.mjs` then `merge_rope_penalty.mjs` -> `mapRopes.js` and
  `mapScores.js`'s displayed `mcScore`/`healScore` (see below)
- `Flatten-MobThumbnails.ps1` -> `public/data/mobs/*.png`
- `build_mobwz_crosswalk.py` -> the monster ID crosswalk (see
  `mobwz_verification_report.json` for the last verification pass' unresolved
  IDs)

`App.jsx` itself only needs edits if you're changing the app's logic or UI,
not for data regeneration.

## Rope/ladder travel penalty

`analyze_maps.py`'s original `mcScore`/`healScore` only look at platform
length, alignment, and floor count -- they assume getting from one
mob-bearing floor to the next costs the same whether it's a short jump or a
long rope climb. It doesn't: rope/ladder travel is much slower, and a map
can score well on paper while being tedious to actually farm (flagged via
map `107000500`, "Dungeon: Damp Tree-Forest" -- scored 4/5 for MC despite 14
separate rope segments covering 84% of its vertical span across 5 floors).

`extract_rope_data.mjs` reads each map's `ladderRope` block and its full
foothold vertical extent, computes `ropeCoverageRatio` (union of rope
y-ranges / total climbable height), and derives a 0-3 point penalty --
gated to maps with a real farm-hopping shape (>=4 mob-bearing floors, >=3
rope segments) so a single portal-access rope on an otherwise flat 1-2 floor
map isn't flagged. `merge_rope_penalty.mjs` then applies that penalty on top
of `analyze_maps.py`'s scores: `mcScoreRaw`/`healScoreRaw` in `mapScores.js`
are the original geometry-only scores, and `mcScore`/`healScore` (what the
UI displays) are penalized. Maps with a penalty show a "ROPE-HEAVY" badge in
the map grid, and the expanded map view's "Ropes/Ladders" toggle overlays
the actual rope/ladder segments on the minimap for visual verification.

## Per-monster session profit (mesos/kill)

Session profit used to multiply every kill by one flat constant
(`INCOME_PER_KILL = 60 + (0.60 * 18) + 286.41`, ~357 mesos regardless of
monster) -- a Snail and a level-80 boss were treated as worth exactly the
same per kill. `MOB_INCOME_PER_KILL` (`src/data/mobDrops.js`) replaces that
with a real, per-monster figure derived from Cosmic's actual drop tables:

    incomePerKill = mesosEV + itemsEV
    mesosEV = sum over itemid=0 drop_data rows of (chance/999999) * avg(minQty,maxQty)
    itemsEV = sum over sellable, non-quest item drop_data rows of
              (chance/999999) * avg(minQty,maxQty) * npcSellPrice(itemid)

Real client WZ data never ships drop tables or NPC sell prices at all --
they're server-authoritative, not client data (confirmed against this
project's own known-good `maplestory_source_wz_extracts.zip`: no
`Item.wz`/`Character.wz`/drop table in any of its zips). So `extract_mob_drops.mjs`
sources `152-drop-data.sql` + `Item.wz`/`Character.wz` NPC `info/price` fields
from the Cosmic private-server repo clone (same repo already used for
Map.wz foothold/rope/spawn data elsewhere in this project) -- the only
place that data exists at all, client or server.

Spot-checked directly against legends.ml/lib (`/lib/use?id=` for Consume items,
`/lib/etc?id=` for Etc items -- plain `WebFetch` gets a 403 there, but `curl`
with a browser `User-Agent` works) -- all 5 checks matched the extracted
`Item.wz` price exactly:

| Item | Extracted price | legends.ml Sell Price |
|---|---|---|
| Mana Elixir (2000006) | 310 | 310 |
| Elixir (2000004) | 1,000 | 1,000 |
| Orange (2070013) | 2,500 | 2,500 |
| Red Potion (2000000) | 25 | 25 |
| Kimono Piece (4000225) | 115 | 115 |

Kept intentionally small -- legends.ml is a community resource, not an API
meant for scraping, so this stayed a handful of manual spot-checks rather
than bulk-validating all ~1,300 priced item ids.

**Monster id crosswalk.** `MONSTER_DB`'s `id` field is a real Mob.wz catalog
id only for the ~1,032 "auto:true" entries pulled straight from the Cosmic
dump -- the ~105 hand-curated meowdb-sourced entries (Snail `id:2`, Mano
`id:700004`, etc.) use meowdb's own display ids, not catalog ids, so they
can't be looked up in `drop_data.sql` directly. `extract_mob_drops.mjs`
crosswalks those by name+level match (±6 levels, same tolerance as
`build_mobwz_crosswalk.py`) against `tools/.wz_cache/String_Mob_wz`
(extracted from the project's own known-good WZ zip, not the live Cosmic
clone, since that's the trusted source for monster identity/names). Some
monster names have multiple same-level catalog ids in the real data (e.g.
Mano has both its normal Beach III version and a level-20 Halloween-candy
event reskin) -- stats don't disambiguate these, so ties are broken toward
whichever candidate has a real mesos drop row (the strongest signal of "this
is the ordinary farmable version," since event/joke reskins typically only
drop novelty items).

88/105 curated monsters resolve this way (matching the existing "88/105
stat-verified" set noted in `monsterDb.js`'s header comment -- same
methodology, same monsters); the 17 that don't resolve, plus ~280 auto
monsters absent from `drop_data.sql` entirely, fall back to the
dataset-wide average income/kill (`FALLBACK_INCOME_PER_KILL` in `App.jsx`)
rather than a single universal constant for every monster. Monster cards
show "est." next to the mesos/kill figure when this fallback applies.

`tools/.wz_cache/` (gitignored) is the working extraction of
`maplestory_source_wz_extracts.zip`'s `String_Mob_wz.zip` that
`extract_mob_drops.mjs` reads from -- re-extract it if regenerating from a
clean checkout.
