// isRopeHeavyMap/isLowSpawnMap/isUnreachableMap/mobWzId reference MAP_SCORES as a
// bare global (set via <script> in index.html in the browser, window.MAP_SCORES) --
// stub it on globalThis before each test to simulate that environment.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isRopeHeavyMap, isLowSpawnMap, isUnreachableMap, mobWzId, scoreColor } from "../src/App";

beforeEach(() => {
  globalThis.MAP_SCORES = {};
});
afterEach(() => {
  delete globalThis.MAP_SCORES;
});

describe("isRopeHeavyMap", () => {
  it("returns false when the map isn't in MAP_SCORES", () => {
    expect(isRopeHeavyMap(999999)).toBe(false);
  });

  it("returns false when ropeCount is 0 even if scores were docked", () => {
    globalThis.MAP_SCORES[1] = { ropeCount: 0, mcScoreRaw: 4, mcScore: 2, lowSpawnPenalty: 0 };
    expect(isRopeHeavyMap(1)).toBe(false);
  });

  it("returns false when the score drop is fully explained by the low-spawn penalty", () => {
    // mcScoreRaw - mcScore (2) equals lowSpawnPenalty (2) -- none of the drop is
    // attributable to ropes, so this must NOT be flagged rope-heavy.
    globalThis.MAP_SCORES[1] = { ropeCount: 5, mcScoreRaw: 4, mcScore: 2, lowSpawnPenalty: 2 };
    expect(isRopeHeavyMap(1)).toBe(false);
  });

  it("returns true when there are ropes AND the score drop exceeds the low-spawn penalty alone", () => {
    globalThis.MAP_SCORES[1] = { ropeCount: 5, mcScoreRaw: 4, mcScore: 2, lowSpawnPenalty: 1 };
    expect(isRopeHeavyMap(1)).toBe(true);
  });

  it("returns true when there's no low-spawn penalty at all and the score still dropped", () => {
    globalThis.MAP_SCORES[1] = { ropeCount: 3, mcScoreRaw: 3, mcScore: 1 };
    expect(isRopeHeavyMap(1)).toBe(true);
  });
});

describe("isLowSpawnMap", () => {
  it("returns false when the map isn't in MAP_SCORES", () => {
    expect(isLowSpawnMap(999999)).toBe(false);
  });

  it("returns false when lowSpawnPenalty is 0 or absent", () => {
    expect(isLowSpawnMap(1)).toBe(false);
    globalThis.MAP_SCORES[1] = { lowSpawnPenalty: 0 };
    expect(isLowSpawnMap(1)).toBe(false);
  });

  it("returns true when lowSpawnPenalty is positive", () => {
    globalThis.MAP_SCORES[1] = { lowSpawnPenalty: 2 };
    expect(isLowSpawnMap(1)).toBe(true);
  });
});

describe("isUnreachableMap", () => {
  it("returns false when the map isn't in MAP_SCORES (unknown, not confirmed unreachable)", () => {
    expect(isUnreachableMap(999999)).toBe(false);
  });

  it("returns false when reachable is true or undefined", () => {
    globalThis.MAP_SCORES[1] = { reachable: true };
    expect(isUnreachableMap(1)).toBe(false);
    globalThis.MAP_SCORES[2] = {};
    expect(isUnreachableMap(2)).toBe(false);
  });

  it("returns true only when reachable is explicitly false", () => {
    globalThis.MAP_SCORES[1] = { reachable: false };
    expect(isUnreachableMap(1)).toBe(true);
  });
});

describe("mobWzId", () => {
  it("returns the id itself (stringified) for auto-imported monsters", () => {
    expect(mobWzId({ id: 100100, auto: true })).toBe("100100");
  });

  it("crosswalks curated monster ids via CATALOG_TO_WZID", () => {
    // id:2 (Snail) is a known curated crosswalk entry -> real WZ id 100100
    expect(mobWzId({ id: 2, auto: false })).toBe("100100");
  });

  it("returns null for a curated monster with no crosswalk entry", () => {
    expect(mobWzId({ id: -12345, auto: false })).toBeNull();
  });
});

describe("scoreColor", () => {
  it("colors 4-5 as good (green)", () => {
    expect(scoreColor(4)).toBe("#4ade80");
    expect(scoreColor(5)).toBe("#4ade80");
  });

  it("colors exactly 3 as neutral (yellow)", () => {
    expect(scoreColor(3)).toBe("#facc15");
  });

  it("colors below 3 as bad (red)", () => {
    expect(scoreColor(1)).toBe("#f87171");
    expect(scoreColor(2)).toBe("#f87171");
  });
});
