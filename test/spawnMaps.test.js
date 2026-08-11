// realMapName/spawnMapsFor read MAP_NAMES as a bare global (window.MAP_NAMES in the
// browser, set via <script> in index.html) -- stub it before each test.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { realMapName, spawnMapsFor } from "../src/App";

beforeEach(() => {
  globalThis.MAP_NAMES = {};
});
afterEach(() => {
  delete globalThis.MAP_NAMES;
});

describe("realMapName", () => {
  it("returns null when the map isn't in MAP_NAMES", () => {
    expect(realMapName(999999999)).toBeNull();
  });

  it("returns the real name when present", () => {
    globalThis.MAP_NAMES[100000000] = "Victoria Road: Henesys";
    expect(realMapName(100000000)).toBe("Victoria Road: Henesys");
  });
});

describe("spawnMapsFor", () => {
  it("returns null for a monster with no known spawn data at all", () => {
    expect(spawnMapsFor(-999999)).toBeNull();
  });

  it("prefers Map.wz-verified REAL_SPAWNS data, marked verified:true", () => {
    // monster id 2 (Snail) has real, Map.wz-verified spawn data
    const spawns = spawnMapsFor(2);
    expect(spawns).not.toBeNull();
    expect(spawns.length).toBeGreaterThan(0);
    for (const s of spawns) {
      expect(s.verified).toBe(true);
      expect(typeof s.mapId).toBe("number");
      expect(typeof s.count).toBe("number");
    }
  });

  it("falls back to curated MONSTER_MAPS data, marked verified:false, when no REAL_SPAWNS entry exists", () => {
    // monster id 700004 (Mano) only has hand-curated spawn data, no Map.wz-verified entry
    const spawns = spawnMapsFor(700004);
    expect(spawns).not.toBeNull();
    expect(spawns.length).toBeGreaterThan(0);
    for (const s of spawns) {
      expect(s.verified).toBe(false);
    }
  });

  it("uses the real map name (MAP_NAMES) over the curated hand-typed name when available", () => {
    const spawns = spawnMapsFor(700004);
    const mapId = spawns[0].mapId;
    globalThis.MAP_NAMES[mapId] = "REAL NAME FROM STRING.WZ";
    const spawnsAfter = spawnMapsFor(700004);
    expect(spawnsAfter[0].name).toBe("REAL NAME FROM STRING.WZ");
  });

  it("falls back to a 'Map #id' placeholder for verified spawns when MAP_NAMES has no entry", () => {
    const spawns = spawnMapsFor(2);
    expect(spawns[0].name).toBe(`Map #${spawns[0].mapId}`);
  });
});
