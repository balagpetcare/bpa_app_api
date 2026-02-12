/**
 * Unit tests for Mapper – normalizeExternalValue, suggestInternalMatch, no auto-assign.
 */
import {
  normalizeExternalValue,
  suggestInternalMatch,
  stringSimilarity,
  levenshteinDistance,
} from "./Mapper";
import { SUGGEST_THRESHOLD } from "../../constants/productImportLimits";

describe("Mapper", () => {
  describe("normalizeExternalValue", () => {
    it("lowercases and collapses spaces", () => {
      expect(normalizeExternalValue("  Royal   Canin  ")).toBe("royal canin");
    });

    it("strips diacritics", () => {
      expect(normalizeExternalValue("café")).toBe("cafe");
    });

    it("returns empty for empty input", () => {
      expect(normalizeExternalValue("")).toBe("");
      expect(normalizeExternalValue(undefined)).toBe("");
    });
  });

  describe("levenshteinDistance / stringSimilarity", () => {
    it("distance 0 for same string", () => {
      expect(levenshteinDistance("abc", "abc")).toBe(0);
    });
    it("similarity 1 for same string", () => {
      expect(stringSimilarity("Royal Canin", "Royal Canin")).toBe(1);
    });
    it("returns similarity in 0-1 range", () => {
      const s = stringSimilarity("Royal", "Royel");
      expect(s).toBeGreaterThan(0);
      expect(s).toBeLessThanOrEqual(1);
    });
  });

  describe("suggestInternalMatch", () => {
    const candidates = [
      { id: 1, name: "Royal Canin" },
      { id: 2, name: "Whiskas" },
      { id: 3, name: "Purina" },
    ];

    it("returns top 3 with score >= threshold", () => {
      const out = suggestInternalMatch("Royal Canin", candidates);
      expect(out.length).toBeLessThanOrEqual(3);
      expect(out[0]).toMatchObject({ id: 1, name: "Royal Canin", score: 1 });
    });

    it("never auto-assigns (caller must use saved mapping)", () => {
      const out = suggestInternalMatch("Royal Canin", candidates, 0.5);
      expect(Array.isArray(out)).toBe(true);
      out.forEach((s) => expect(s).toHaveProperty("score"));
    });

    it("returns empty when no candidate meets threshold", () => {
      const out = suggestInternalMatch("xyzzz", candidates, 0.99);
      expect(out.length).toBe(0);
    });

    it("uses SUGGEST_THRESHOLD by default", () => {
      const out = suggestInternalMatch("Royal", candidates);
      expect(out.every((s) => s.score >= SUGGEST_THRESHOLD)).toBe(true);
    });
  });
});
