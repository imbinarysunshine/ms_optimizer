import { describe, it, expect } from "vitest";
import { EXP_TABLE } from "../../src/data/expTable";

describe("EXP_TABLE", () => {
  it("is an array with a level-0 placeholder", () => {
    expect(Array.isArray(EXP_TABLE)).toBe(true);
    expect(EXP_TABLE[0]).toBe(0);
  });

  it("covers at least levels 1-49", () => {
    expect(EXP_TABLE.length).toBeGreaterThanOrEqual(50);
  });

  it("every entry is a non-negative finite number", () => {
    for (let i = 0; i < EXP_TABLE.length; i++) {
      expect(Number.isFinite(EXP_TABLE[i]), `index ${i}`).toBe(true);
      expect(EXP_TABLE[i], `index ${i}`).toBeGreaterThanOrEqual(0);
    }
  });

  it("is monotonically non-decreasing (higher levels never need less exp than lower ones)", () => {
    for (let i = 2; i < EXP_TABLE.length; i++) {
      expect(EXP_TABLE[i], `EXP_TABLE[${i}] vs [${i - 1}]`).toBeGreaterThanOrEqual(EXP_TABLE[i - 1]);
    }
  });

  it("matches known reference values (level 1->2 = 15, level 2->3 = 34)", () => {
    expect(EXP_TABLE[1]).toBe(15);
    expect(EXP_TABLE[2]).toBe(34);
  });
});
