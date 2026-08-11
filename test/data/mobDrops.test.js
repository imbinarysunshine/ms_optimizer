import { describe, it, expect } from "vitest";
import { MOB_INCOME_PER_KILL } from "../../src/data/mobDrops";
import { MONSTER_DB } from "../../src/data/monsterDb";

describe("MOB_INCOME_PER_KILL", () => {
  it("is a non-empty object", () => {
    expect(typeof MOB_INCOME_PER_KILL).toBe("object");
    expect(Object.keys(MOB_INCOME_PER_KILL).length).toBeGreaterThan(500);
  });

  it("every value is a non-negative finite number", () => {
    for (const [id, income] of Object.entries(MOB_INCOME_PER_KILL)) {
      expect(Number.isFinite(income), `id ${id}`).toBe(true);
      expect(income, `id ${id}`).toBeGreaterThanOrEqual(0);
    }
  });

  it("every key corresponds to a real MONSTER_DB id", () => {
    const dbIds = new Set(MONSTER_DB.map(m => String(m.id)));
    for (const id of Object.keys(MOB_INCOME_PER_KILL)) {
      expect(dbIds.has(id), `MOB_INCOME_PER_KILL id ${id} not found in MONSTER_DB`).toBe(true);
    }
  });

  it("keys are numeric-string monster ids, not names", () => {
    for (const id of Object.keys(MOB_INCOME_PER_KILL)) {
      expect(/^\d+$/.test(id), `key "${id}" should be a plain numeric id`).toBe(true);
    }
  });
});
