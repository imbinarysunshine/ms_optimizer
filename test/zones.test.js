// monsterZones reads WORLD_MAP_DATA as a bare global (window.WORLD_MAP_DATA in the
// browser) and internally calls spawnMapsFor (real REAL_SPAWNS/MONSTER_MAPS data,
// not mockable) -- so tests stub WORLD_MAP_DATA.spots for known real monster ids'
// real spawn map ids rather than using synthetic ones.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { monsterZones, ZONE_NAMES } from "../src/App";

beforeEach(() => {
  globalThis.WORLD_MAP_DATA = { spots: {}, regions: {} };
});
afterEach(() => {
  delete globalThis.WORLD_MAP_DATA;
});

describe("ZONE_NAMES", () => {
  it("includes the documented classic continents/areas", () => {
    expect(ZONE_NAMES).toContain("Victoria Island");
    expect(ZONE_NAMES).toContain("Ossyria");
    expect(ZONE_NAMES).toContain("Maple Island");
  });

  it("has no duplicate zone names", () => {
    expect(new Set(ZONE_NAMES).size).toBe(ZONE_NAMES.length);
  });
});

describe("monsterZones", () => {
  // monster id 2 (Snail) has real, Map.wz-verified spawn maps: 40001, 50000, 40002,
  // 1010004, 104000100, 1000004, 104000200, 1020001
  it("returns an empty set for a monster with no spawn map data", () => {
    expect(monsterZones({ id: -999999 })).toEqual(new Set());
  });

  it("returns an empty set when spawn maps have no resolved world-map spot", () => {
    // WORLD_MAP_DATA.spots is empty (stubbed in beforeEach), so no region resolves
    expect(monsterZones({ id: 2 })).toEqual(new Set());
  });

  it("maps a resolved spawn map's region to the correct zone", () => {
    globalThis.WORLD_MAP_DATA.spots[40001] = { region: "WorldMap10", x: 0, y: 0 };
    expect(monsterZones({ id: 2 })).toEqual(new Set(["Victoria Island"]));
  });

  it("collects zones from every spawn map, deduplicated", () => {
    globalThis.WORLD_MAP_DATA.spots[40001] = { region: "WorldMap10", x: 0, y: 0 }; // Victoria Island
    globalThis.WORLD_MAP_DATA.spots[50000] = { region: "WorldMap12", x: 0, y: 0 }; // also Victoria Island
    globalThis.WORLD_MAP_DATA.spots[40002] = { region: "WorldMap20", x: 0, y: 0 }; // Ossyria
    const zones = monsterZones({ id: 2 });
    expect(zones).toEqual(new Set(["Victoria Island", "Ossyria"]));
  });

  it("ignores an unrecognized region code rather than throwing", () => {
    globalThis.WORLD_MAP_DATA.spots[40001] = { region: "SomeFutureRegionCode", x: 0, y: 0 };
    expect(monsterZones({ id: 2 })).toEqual(new Set());
  });
});
