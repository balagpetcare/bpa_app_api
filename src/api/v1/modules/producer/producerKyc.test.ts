/**
 * Minimal tests for Producer KYC service (validation helpers).
 * Run: npm test -- producerKyc.test.ts
 */

const {
  getMissingDocTypes,
  isAllowedMime,
  isAllowedDocType,
  PRODUCER_KYC_ALLOWED_MIMES,
} = require("./producerKyc.service");

describe("producerKyc.service", () => {
  describe("getMissingDocTypes", () => {
    it("requires at least one business doc and one identity doc", () => {
      expect(getMissingDocTypes([]).length).toBeGreaterThan(0);
      expect(getMissingDocTypes(["NID_FRONT"]).length).toBeGreaterThan(0);
      expect(getMissingDocTypes(["TRADE_LICENSE"]).length).toBeGreaterThan(0);
      expect(getMissingDocTypes(["NID_FRONT", "TRADE_LICENSE"])).toEqual([]);
      expect(getMissingDocTypes(["SELFIE_WITH_NID", "INCORPORATION_CERT"])).toEqual([]);
      expect(getMissingDocTypes(["NID_FRONT", "OTHER"])).toEqual([]);
    });
  });

  describe("isAllowedMime", () => {
    it("allows images and PDF", () => {
      expect(isAllowedMime("image/jpeg")).toBe(true);
      expect(isAllowedMime("image/png")).toBe(true);
      expect(isAllowedMime("image/webp")).toBe(true);
      expect(isAllowedMime("application/pdf")).toBe(true);
      expect(isAllowedMime("image/gif")).toBe(false);
      expect(isAllowedMime("application/octet-stream")).toBe(false);
    });
  });

  describe("isAllowedDocType", () => {
    it("allows Producer KYC doc types", () => {
      expect(isAllowedDocType("NID_FRONT")).toBe(true);
      expect(isAllowedDocType("TRADE_LICENSE")).toBe(true);
      expect(isAllowedDocType("OTHER")).toBe(true);
      expect(isAllowedDocType("INVALID")).toBe(false);
    });
  });

  it("PRODUCER_KYC_ALLOWED_MIMES includes expected types", () => {
    expect(PRODUCER_KYC_ALLOWED_MIMES).toContain("image/jpeg");
    expect(PRODUCER_KYC_ALLOWED_MIMES).toContain("application/pdf");
  });
});
