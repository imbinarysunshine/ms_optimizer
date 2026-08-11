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
  App.jsx            The app itself (monster DB, damage formulas, session
                      profit model, filters, map/world-map views)
public/data/
  mapScores.js        window.MAP_SCORES -- Map.wz-derived MC/Heal training
                       fit scores for 1,892 maps
  mapNames.js         window.MAP_NAMES -- mapId -> display name
  worldMapData.js      window.WORLD_MAP_DATA -- mapId -> world-map spot
                       coordinates + per-region image dimensions
  thumbs/<mapId>.png   Minimap thumbnails extracted from Map.wz
  worldmaps/<Region>.png  Regional world-map overview images from WorldMap.wz
  mobs/<catalogId>.png   Monster sprites extracted from Mob.wz
tools/
  analyze_maps.py           Regenerates mapScores.js from Map.wz data
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

The `public/data/*.js` files still work the old way: they set `window.MAP_SCORES`,
`window.MAP_NAMES`, and `window.WORLD_MAP_DATA` as globals rather than ES
module exports, and `index.html` loads them via plain `<script>` tags before
mounting the app, exactly like the old bundle did. `App.jsx` references them
by their global names (e.g. `MAP_SCORES[mapId]`), so this wasn't changed.

## Regenerating data after a Map.wz/Mob.wz re-export

If more of Map.wz, WorldMap.wz, or Mob.wz gets exported later (to close gaps
on unresolved monsters or missing thumbnails), the scripts in `tools/` are
what regenerate `public/data/`:
- `analyze_maps.py` -> `mapScores.js`
- `Flatten-MobThumbnails.ps1` -> `public/data/mobs/*.png`
- `build_mobwz_crosswalk.py` -> the monster ID crosswalk (see
  `mobwz_verification_report.json` for the last verification pass' unresolved
  IDs)

`App.jsx` itself only needs edits if you're changing the app's logic or UI,
not for data regeneration.
