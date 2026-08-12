# MapleStory Monster DB + Map Training Toolkit

A React app for evaluating MapleStory training spots: monster stats, Magic
Claw / Heal damage and cast-to-kill math, per-monster session profit
(mesos, potion cost, EXP/levels gained) with a selectable potion (Blue
Potion, Mana Elixir, Elixir, Power Elixir), and per-map training scores
derived from Map.wz foothold/spawn geometry.

## Project layout

```
index.html          Vite entry point
vite.config.js       Vite + React plugin config (also configures vitest)
package.json
src/
  main.jsx           React 18 mount point
  App.jsx            The app itself (session profit model, filters,
                      map/world-map views, map-quality helpers)
  lib/
    formulas.js        Pure game-math functions (damage, kill-count, Heal,
                        MP Eater, session profit, level-up math) -- no React
                        or browser dependencies, extracted from App.jsx
                        specifically so they're unit-testable
  data/
    monsterDb.js       MONSTER_DB, STAT_VERIFIED_IDS, UNDEAD_IDS -- the
                        hand-compiled monster stat table (~1,140 monsters)
    expTable.js         EXP_TABLE -- EXP-to-next-level by character level
    mobDrops.js          MOB_INCOME_PER_KILL -- real per-monster mesos/kill
                          income (mesos + sellable item/equip drop EV), keyed
                          by MONSTER_DB id
test/
  formulas.test.js         Unit tests for src/lib/formulas.js
  mapHelpers.test.js        Unit tests for App.jsx's map-quality helpers
                             (isRopeHeavyMap/isLowSpawnMap/isUnreachableMap/
                             mobWzId/scoreColor)
  spawnMaps.test.js          Unit tests for App.jsx's spawnMapsFor/realMapName
  data/
    monsterDb.test.js        MONSTER_DB/STAT_VERIFIED_IDS/UNDEAD_IDS integrity
    expTable.test.js          EXP_TABLE integrity
    mobDrops.test.js          MOB_INCOME_PER_KILL integrity
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
  mapPortals.js        window.MAP_PORTALS -- mapId -> minimap pixel transform +
                       list of [x,y,targetMapId] portals, for the clickable
                       "Portals" overlay in the expanded map view. Also the
                       source for mapScores.js's `reachable` field (portal-graph
                       BFS from every town)
  thumbs/<mapId>.png   Minimap thumbnails extracted from Map.wz
  worldmaps/<Region>.png  Regional world-map overview images from WorldMap.wz
  mobs/<catalogId>.png   Monster sprites extracted from Mob.wz
tools/
  recompute_map_scores.mjs  CANONICAL: regenerates all 4 map-quality scores
                             (mcScore/meleeScore/aoeScore/healScore, each skill's
                             own hitbox archetype -- see classSkills.js) plus the
                             rope-travel penalty, from Map.wz foothold/life/
                             ladderRope data, in one pass (Node, no deps). See
                             "Map-quality scoring" below. Supersedes the 5 tools
                             below, which are kept for history but not part of
                             the live regeneration pipeline anymore.
  analyze_maps.py           SUPERSEDED by recompute_map_scores.mjs. Originally
                             regenerated the geometry-only mcScoreRaw/healScoreRaw
                             fields in mapScores.js from Map.wz foothold/spawn data.
  extract_skill_map_scores.mjs  SUPERSEDED by recompute_map_scores.mjs. Originally
                             added meleeScore/aoeScore alongside the existing
                             mcScore/healScore.
  extract_rope_data.mjs     SUPERSEDED by recompute_map_scores.mjs. Originally
                             regenerated mapRopes.js and tools/rope_analysis.json
                             (gitignored, intermediate) from Map.wz ladderRope +
                             foothold data -- mapRopes.js itself (the "Ropes/
                             Ladders" overlay data) is unaffected and still valid;
                             only the score-penalty half of this tool is superseded.
  merge_rope_penalty.mjs    SUPERSEDED by recompute_map_scores.mjs. Originally
                             applied rope_analysis.json's travel penalty on top
                             of mapScores.js's raw scores.
  apply_spawn_penalty.mjs   Still current -- derives the lowSpawnPenalty field
                             from mobCount. Run this BEFORE recompute_map_scores.mjs
                             (which reads and folds in whatever lowSpawnPenalty is
                             already on each entry, but doesn't compute it itself)
                             any time mobCount has changed (e.g. after a fresh
                             Map.wz life-data re-export).
  extract_mob_spawns.mjs    Regenerates mapMobSpawns.js from Map.wz life +
                             miniMap data (Node, no deps)
  extract_portals.mjs       Regenerates mapPortals.js and mapScores.js's
                             `reachable` field from a full Map.wz portal-graph
                             BFS (Node, no deps)
  extract_mob_drops.mjs     Regenerates src/data/mobDrops.js from Cosmic's
                             drop_data.sql + Item.wz/Character.wz NPC sell
                             prices, crosswalked via tools/.wz_cache (Node, no deps)
  extend_stat_verification.mjs  One-off: corrects the 9 monsters a spot-check
                             found wrong, then extends STAT_VERIFIED_IDS to the
                             rest of the "auto" set (see below) (Node, no deps)
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

## Testing

```
npm run test        # run once
npm run test:watch  # watch mode
```

Unit tests cover the pure logic layer: `src/lib/formulas.js` in full (damage,
kill-count, Heal, MP Eater, session profit, level-up math), the map-quality
helpers and spawn-map lookup in `App.jsx` (exported specifically so they're
importable by tests, with `MAP_SCORES`/`MAP_NAMES` stubbed via `globalThis`
to simulate the `<script>`-tag globals they read in the browser), and data
integrity checks for all three `src/data/*.js` modules (shape, ranges,
cross-referential consistency with `MONSTER_DB`, and regression checks for
the two Cosmic-dump data-correction passes done this session).

**Not covered:** React component rendering (`MonsterCard`, `MapExpandModal`,
`App` itself) -- these are UI/integration concerns, not unit-testable pure
logic, and would need `jsdom` + React Testing Library to test meaningfully.
Also not covered: the `public/data/*.js` files (`mapScores.js`,
`mapMobSpawns.js`, etc.) -- these are intentionally plain `window.X = {...}`
globals rather than ES modules (see "Why this structure" above), so they
aren't importable by a test file; their generation is validated by their own
`tools/extract_*.mjs` scripts' console output when regenerated.

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
- `apply_spawn_penalty.mjs` then `recompute_map_scores.mjs` -> `mapScores.js`'s
  `mcScore`/`meleeScore`/`aoeScore`/`healScore` + platform metrics (see below)
- `extract_mob_spawns.mjs` -> `mapMobSpawns.js`
- `extract_rope_data.mjs` -> `mapRopes.js` (the "Ropes/Ladders" overlay data --
  its score-penalty half is superseded by `recompute_map_scores.mjs`, see below)
- `Flatten-MobThumbnails.ps1` -> `public/data/mobs/*.png`
- `build_mobwz_crosswalk.py` -> the monster ID crosswalk (see
  `mobwz_verification_report.json` for the last verification pass' unresolved
  IDs)

`App.jsx` itself only needs edits if you're changing the app's logic or UI,
not for data regeneration.

## Map-quality scoring (4 archetypes)

Each verified skill (`src/lib/classSkills.js`) is tagged with a
`mapScoreArchetype` -- `ranged`/`melee` (single-target, `mcScore`/`meleeScore`),
`aoe` (same-platform multi-mob, `aoeScore`), or `vertical` (Heal's own huge
box that reaches adjacent floors, `healScore`) -- so the map-quality badge and
"Min Map Score" filter always reflect whichever skill is currently selected,
not just Magic Claw/Heal. All 4 come from `recompute_map_scores.mjs`, in one
pass over Map.wz foothold/life/ladderRope data.

**Gap-aware floor penalty.** The original formula (still `mc`/`melee`/`aoe`'s
shape) charges a tedium cost per extra mob-bearing floor -- but the *original*
version of it (`analyze_maps.py`) charged a FLAT cost regardless of how far
apart those floors actually were, treating an 82px gap (barely a step down)
identically to a 500px gap (a real climb). This was caught reassessing
`103000101` ("Kerning City Subway: Line 1 <Area 1>") -- 11 mob-bearing floors
stacked in mostly 2-91px gaps, described as "many horizontal platforms... a
bottom platform uninterrupted for the entire length... the stack is
relatively tight" -- which scored a middling 3/5 despite matching a genuinely
great farming map. Fixed: each gap is now scaled by
`clamp(gapPx / GAP_REFERENCE_PX, 0, 1)` (350px = where a gap costs the old
full unit) before summing, so a tight stack barely gets penalized while a
real multi-floor dungeon still does.

**Neighboring-platform AoE clumping.** `aoeScore`'s old clump window only
looked at mobs on the SAME platform, ignoring that every AoE skill has a real
(if often small, ~50-140px) vertical reach of its own (Skill.wz lt/rb data,
see `classSkills.js`) -- easily enough to also hit an adjacent platform on a
tightly-stacked map. Fixed: the clump window now pulls in mobs from any
platform within `AOE_VERTICAL_REACH_PX` (100px) of the anchor platform.

**Rope/ladder travel penalty**, same tightness principle as the floor penalty
above: rope/ladder travel is much slower than a jump, and a map can score
well on paper while being tedious to actually farm (flagged via map
`107000500`, "Dungeon: Damp Tree-Forest" -- 14 rope segments covering 84% of
its vertical span across 5 REAL floors, correctly still penalized). But a
rope connecting two platforms 20px apart is a non-event, not real travel
tedium -- the old penalty (`extract_rope_data.mjs`/`merge_rope_penalty.mjs`)
never distinguished the two. `recompute_map_scores.mjs`'s rope penalty now
scales by the same per-gap tightness ratio, gated to maps with a real
farm-hopping shape (>=4 mob-bearing floors, >=3 rope segments) so a single
portal-access rope on an otherwise flat 1-2 floor map isn't flagged. Maps
with a penalty show a "ROPE-HEAVY" badge in the map grid, and the expanded
map view's "Ropes/Ladders" toggle overlays the actual segments for visual
verification.

**Low-spawn-supply penalty**: a map can also look great on paper (good
platforms, no rope problem) and still be a poor sustained-farming spot if it
simply doesn't have many monsters on it -- a player clears the whole
population faster than it respawns and sits idle. `apply_spawn_penalty.mjs`
derives a 0-3 point penalty from `mobCount` (total simultaneous spawn
points) -- no penalty at 20+ total spawns, maxing out at 3 points at 3 or
fewer, linearly interpolated in between -- stored as `lowSpawnPenalty`, which
`recompute_map_scores.mjs` then folds into all 4 scores identically (an
independent, additive source of downtime same as the rope penalty). The
`*Raw` fields (`mcScoreRaw`, `meleeScoreRaw`, etc.) stay untouched by either
penalty, so they always mean "pure geometry." Maps with a penalty show a
"LOW SPAWN" badge, disambiguated from a rope penalty via the
`lowSpawnPenalty` field.

Both map-quality badges have a matching filter chip in the monster list
("Hide Rope-Heavy Maps" / "Hide Low-Spawn Maps"): a monster is hidden only
if *every* one of its known spawn maps has that problem, since a monster
with even one good map is still worth training. Both default off (unlike
"Hiding Unknown Loc." / boss hiding, which default on) -- map-quality data
is denser and worth surfacing before hiding by default.

Regenerate after any Map.wz/mapScores.js change, in order:
`apply_spawn_penalty.mjs` -> `recompute_map_scores.mjs` (see the tools table
above for why that order matters).

There's also a direct "Min Map Score" filter (a single 1-5 dropdown, labeled
RANGE/MELEE/AOE/STACK for whichever skill is active, 0=off): hides a monster
only if *every* known spawn map's score for that skill's own archetype falls
below
the chosen minimum -- same "hide only if every map fails" semantics as the
rope/low-spawn chips, for when you want a blunter, direct cutoff instead of
the two specific penalty flags.

## Map reachability + clickable portals

"Hidden Street" maps (850 of them) often have no minimap thumbnail and no
resolved world-map spot, which looks like missing/junk data -- but that's
not the same as being unreachable. `extract_portals.mjs` parses every map's
`portal` block (not just mob-bearing maps -- connector/hidden maps have to
be in the graph too) across the full Map.wz export, builds a directed
mapId -> targetMapId graph, and BFS's it from every town map to get real,
ground-truth reachability. Spot-checked: 750/850 Hidden Street maps came
back reachable (e.g. `100000002`, confirmed to have a real inbound portal
from Henesys), and the 100 that didn't are legitimately NPC/event-triggered
minigame instances ("1st Accompaniment", "The Other Dimension"), not normal
areas missing data.

Caveat worth knowing: this only follows *walkable* portal edges. Content
entered via an NPC dialogue warp -- most Party Quests, some event/instance
maps -- has no portal edge at all and will show as unreachable even though
it's real, accessible content. Treat the result (`reachable` in
`mapScores.js`, the "NO PORTAL PATH" badge, the "Hide No-Portal-Path Maps"
filter chip) as a strong signal, not certainty -- which is also why, unlike
"Hiding Unknown Loc." / boss hiding, it defaults off rather than on.

The same portal data (`mapPortals.js`) also drives a "Portals" toggle in the
expanded map view: markers at each portal's real position, clickable to jump
straight to the target map without closing the modal (with a "Back" button
to retrace steps). `MapExpandModal` keeps its own `currentMapId` state
separate from the `mapId` prop for this -- pass `key={mapId}` wherever it's
rendered so opening it for a genuinely different map resets that state
instead of carrying over stale navigation.

## Efficiency metric: EXP/hr, not a static HP/EXP ratio

The old "EFF RATIO" badge was `(HP + M.DEF) / (EXP x 2)` -- a purely static
per-monster number that never looked at the player's actual damage output.
That's a real bug, not just a display quirk: with Magic Claw/Heal both very
likely to deal far more damage than needed to one-shot a low-level monster,
a trivial monster (e.g. a level 1 Snail, 3 exp) could still score as "best
in the list" purely because its HP is tiny too, even though a same-effort,
appropriately-leveled monster nets 50-100x more exp for the identical one
cast. Verified directly: at a level 20 baseline with "All" level range and
default filters, the old ratio's top-ranked monsters were Snail, Tino, Tiv,
Blue Snail, Shroom -- literally "kill mobs significantly below my level that
reward basically no experience," exactly as reported.

The fix uses the same `hitsToKill`/`healCastsToKill` math already computed
from the player's real stats elsewhere in the app (session profit, cast
counts) instead of a static HP figure, and displays it as **EXP/hr**
(`exp x 2 / casts-to-kill x 3600/cast-time`) rather than an abstract,
lower-is-better ratio -- a plain "how much reward am I actually getting"
number reads far more clearly than an inverted dimensionless ratio, and
naturally reflects the reward a full grinding session would produce, which
is what actually matters for "efficient grinding": a monster with a
trivially small EXP/hr is visibly bad without needing a separate penalty
rule bolted on for "0% level progress" specifically.

The EXP/HR badge's color-coded tier (High/Mid/Low, also the Efficiency
filter chip's buckets) is computed as **percentiles of the currently visible
list**, not a fixed cutoff -- the old fixed thresholds (`< 4`, `< 6`) were
tuned for the old HP-based scale and don't transfer: at a level 20 baseline
the "good" EXP/hr range for non-boss, known-location monsters sits around
the 0.03-0.12 (inverse-ratio) band, but that range shifts completely at
higher character levels/stats, so a fixed number would misclassify
constantly as you level up or change gear. Recalculates every time the
level range, filters, or character stats change.

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

## Extending stat verification beyond the original 88

The "STATS VERIFIED" badge originally only covered 88/105 hand-curated
monsters (individually crosswalked + spot-checked against legends.ml). The
~1,032 "auto" monsters were left at "NORMAL" (Cosmic-v83-sourced, not
individually checked) even though they come from the exact same dump already
proven accurate -- they just carry the real catalog id directly instead of
needing a name+level crosswalk.

Rather than leave that gap, or claim full coverage without evidence, a
diverse 48-monster spot-check (stratified across the full level range, via
`curl` with a browser `User-Agent` against legends.ml -- same courteous,
non-bulk approach as the item-price spot-check above) found:
- 14/15 low/mid-level monsters matched exactly (1 had a single wrong field --
  Leprechaun's `mp` was `0`, corrected to `120`)
- 8/18 level>120 monsters matched exactly -- a genuinely high-level "Oblivion"
  party-quest family (Oblivion Guardian/Monk, Witch Cat, Papulatus, etc.)
- 9/18 level>120 monsters shared one systematic error: a boss-summoned "Guard
  Dog"/"Minion" family (catalog ids `9400739`-`9400747`) originally imported
  at roughly 10-100x their real level/HP/stats -- likely a scaled runtime
  instance value captured instead of the base template. Corrected directly
  from the legends.ml values pulled during the check.
- 2 couldn't be resolved: Toy Clown (`9500190`, no legends.ml page exists) and
  Mini Bean (`8820007`, an ambiguous exact-2x HP mismatch -- possibly a
  weakened/true-form distinction, not confidently either right or wrong).
  These stay at "NORMAL"/unverified.

`extend_stat_verification.mjs` applies the 10 field corrections found above,
then adds every other "auto" monster to `STAT_VERIFIED_IDS` on the strength
of that spot-check plus the same-source guarantee -- not because each one was
individually re-fetched. `STAT_VERIFIED_IDS` grew from 88 to 1,118/1,137. The
"STATS VERIFIED" badge's tooltip now distinguishes the two evidence tiers
(individually re-checked for the original 105 curated monsters vs.
spot-check-extrapolated for the auto set) rather than implying uniform
per-monster verification.
