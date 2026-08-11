import { describe, it, expect } from "vitest";
import { MONSTER_DB, STAT_VERIFIED_IDS, UNDEAD_IDS } from "../../src/data/monsterDb";

const NUMERIC_FIELDS = ["level", "hp", "mp", "wAtk", "mAtk", "wDef", "mDef", "acc", "avoid", "exp"];
const STRING_FIELDS = ["name", "weak", "strong", "immune", "location"];

describe("MONSTER_DB shape", () => {
  it("is a non-empty array", () => {
    expect(Array.isArray(MONSTER_DB)).toBe(true);
    expect(MONSTER_DB.length).toBeGreaterThan(1000);
  });

  it("every entry has all required numeric fields as finite numbers", () => {
    for (const m of MONSTER_DB) {
      for (const field of NUMERIC_FIELDS) {
        expect(Number.isFinite(m[field]), `${m.name} (id ${m.id}) .${field}`).toBe(true);
      }
    }
  });

  it("every entry has all required string fields as strings", () => {
    for (const m of MONSTER_DB) {
      for (const field of STRING_FIELDS) {
        expect(typeof m[field], `${m.name} (id ${m.id}) .${field}`).toBe("string");
      }
    }
  });

  it("every entry has a boolean boss flag", () => {
    for (const m of MONSTER_DB) {
      expect(typeof m.boss, `${m.name} (id ${m.id}) .boss`).toBe("boolean");
    }
  });

  it("no negative stats, except accuracy which a handful of monsters (the Snowman family) genuinely have negative", () => {
    const fieldsRequiringNonNegative = NUMERIC_FIELDS.filter(f => f !== "acc");
    for (const m of MONSTER_DB) {
      for (const field of fieldsRequiringNonNegative) {
        expect(m[field], `${m.name} (id ${m.id}) .${field}`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("ids are unique", () => {
    const ids = MONSTER_DB.map(m => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("auto-imported entries carry the real Mob.wz catalog id convention (numeric, no meowdb-style small ids mixed in silently)", () => {
    const autoEntries = MONSTER_DB.filter(m => m.auto);
    expect(autoEntries.length).toBeGreaterThan(900);
    for (const m of autoEntries) {
      expect(Number.isInteger(m.id)).toBe(true);
    }
  });
});

describe("STAT_VERIFIED_IDS", () => {
  it("is a Set", () => {
    expect(STAT_VERIFIED_IDS).toBeInstanceOf(Set);
  });

  it("every verified id corresponds to a real MONSTER_DB entry", () => {
    const dbIds = new Set(MONSTER_DB.map(m => m.id));
    for (const id of STAT_VERIFIED_IDS) {
      expect(dbIds.has(id), `verified id ${id} not found in MONSTER_DB`).toBe(true);
    }
  });

  it("covers the large majority of the database (extended verification pass)", () => {
    expect(STAT_VERIFIED_IDS.size).toBeGreaterThan(1000);
    expect(STAT_VERIFIED_IDS.size).toBeLessThanOrEqual(MONSTER_DB.length);
  });

  it("known-corrected Guard Dog/Minion family entries are verified with sane values", () => {
    // Regression check for the specific 9x systematic-error correction: these were
    // originally imported at ~10-100x their real level/stats (see
    // tools/extend_stat_verification.mjs) -- confirm they're both verified and no
    // longer carry the absurd pre-BB-implausible level (140-170).
    const correctedIds = [9400739, 9400740, 9400741, 9400742, 9400743, 9400745, 9400746, 9400747];
    for (const id of correctedIds) {
      const m = MONSTER_DB.find(x => x.id === id);
      expect(m, `id ${id} missing from MONSTER_DB`).toBeTruthy();
      expect(STAT_VERIFIED_IDS.has(id), `id ${id} should be verified`).toBe(true);
      expect(m.level, `id ${id} level should be corrected to a sane value`).toBeLessThan(20);
    }
  });

  it("known-unresolved entries (Toy Clown, Mini Bean) stay unverified", () => {
    expect(STAT_VERIFIED_IDS.has(9500190)).toBe(false); // Toy Clown -- no legends.ml page
    expect(STAT_VERIFIED_IDS.has(8820007)).toBe(false); // Mini Bean -- ambiguous 2x HP mismatch
  });
});

describe('"(PC)" PC-cafe-exclusive variants (removed)', () => {
  // Old PC-cafe-exclusive enhanced-rate monster variants (e.g. "Jr. Necki (PC)") were
  // confirmed not implemented on MapleLegends and removed from MONSTER_DB entirely
  // (tools/remove_pc_variants.mjs) -- filtering them at render time was a half-measure.
  // Regression check that they don't reappear (e.g. via a careless data regeneration).
  it("no monster names contain a '(PC)' suffix", () => {
    const pcVariants = MONSTER_DB.filter(m => m.name.includes("(PC)"));
    expect(pcVariants).toEqual([]);
  });

  it("known removed ids (Jr. Necki (PC), Ligator (PC), etc.) are gone", () => {
    const removedIds = [9300002, 9200000, 9200010, 9200006, 9200012, 9300000, 9200005, 9300001,
      9200009, 9200008, 9200003, 9200014, 9200007, 9200011, 9200002, 9200001, 9200004, 9200013];
    const dbIds = new Set(MONSTER_DB.map(m => m.id));
    for (const id of removedIds) {
      expect(dbIds.has(id), `id ${id} should have been removed`).toBe(false);
    }
  });
});

describe("UNDEAD_IDS", () => {
  it("is a Set", () => {
    expect(UNDEAD_IDS).toBeInstanceOf(Set);
  });

  it("every undead id corresponds to a real MONSTER_DB entry", () => {
    const dbIds = new Set(MONSTER_DB.map(m => m.id));
    for (const id of UNDEAD_IDS) {
      expect(dbIds.has(id), `undead id ${id} not found in MONSTER_DB`).toBe(true);
    }
  });

  it("is non-empty", () => {
    expect(UNDEAD_IDS.size).toBeGreaterThan(0);
  });
});

describe("elemental tags", () => {
  it("weak/strong/immune only ever use real element names, '/'-joined compounds, or the '-' sentinel", () => {
    const validElements = new Set(["Ice", "Fire", "Lightning", "Poison", "Holy", "Dark"]);
    const isValid = value => value === "-" || value.split("/").every(part => validElements.has(part));
    for (const m of MONSTER_DB) {
      for (const field of ["weak", "strong", "immune"]) {
        expect(isValid(m[field]), `${m.name} (id ${m.id}) .${field}="${m[field]}"`).toBe(true);
      }
    }
  });

  it("'strong' is cleared across the board (no partial-resist tier in classic/pre-BB)", () => {
    // Documented in monsterDb.js's header comment: elemAttr digits only ever run
    // 1-3 (immune/normal/weak) across the whole Mob.wz corpus -- "strong" was
    // deliberately zeroed out project-wide, not per-monster.
    for (const m of MONSTER_DB) {
      expect(m.strong, `${m.name} (id ${m.id})`).toBe("-");
    }
  });
});
