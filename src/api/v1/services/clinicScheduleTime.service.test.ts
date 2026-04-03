/**
 * Tests for clinic schedule timezone helpers (pure utils, no DB).
 * Run with: npx jest clinicScheduleTime.service.test.ts
 */
const {
  getTimezoneOffsetMinutes,
  parseTimeHHmm,
  localTimeToUTC,
  getDayOfWeekInTimezone,
} = require("./clinicScheduleTime.utils");

describe("clinicScheduleTime.service", () => {
  describe("parseTimeHHmm", () => {
    it("parses HH:mm", () => {
      expect(parseTimeHHmm("09:00")).toEqual({ h: 9, m: 0 });
      expect(parseTimeHHmm("17:00")).toEqual({ h: 17, m: 0 });
      expect(parseTimeHHmm("00:00")).toEqual({ h: 0, m: 0 });
      expect(parseTimeHHmm("23:59")).toEqual({ h: 23, m: 59 });
    });
    it("returns null for invalid", () => {
      expect(parseTimeHHmm("")).toBeNull();
      expect(parseTimeHHmm("25:00")).toBeNull();
      expect(parseTimeHHmm("12:60")).toBeNull();
      expect(parseTimeHHmm("ab:cd")).toBeNull();
    });
  });

  describe("getTimezoneOffsetMinutes", () => {
    it("returns +360 for Asia/Dhaka", () => {
      expect(getTimezoneOffsetMinutes("Asia/Dhaka")).toBe(360);
    });
    it("returns 0 for UTC", () => {
      expect(getTimezoneOffsetMinutes("UTC")).toBe(0);
    });
    it("returns 0 for unknown zone", () => {
      expect(getTimezoneOffsetMinutes("Unknown/Zone")).toBe(0);
    });
  });

  describe("localTimeToUTC", () => {
    it("converts 09:00 Asia/Dhaka to 03:00 UTC same date", () => {
      const d = localTimeToUTC("2025-03-17", { h: 9, m: 0 }, 360);
      expect(d.getUTCHours()).toBe(3);
      expect(d.getUTCMinutes()).toBe(0);
      expect(d.getUTCDate()).toBe(17);
      expect(d.getUTCMonth()).toBe(2);
    });
    it("converts 17:00 Asia/Dhaka to 11:00 UTC same date", () => {
      const d = localTimeToUTC("2025-03-17", { h: 17, m: 0 }, 360);
      expect(d.getUTCHours()).toBe(11);
      expect(d.getUTCMinutes()).toBe(0);
    });
    it("converts 00:00 Asia/Dhaka to previous day 18:00 UTC", () => {
      const d = localTimeToUTC("2025-03-17", { h: 0, m: 0 }, 360);
      expect(d.getUTCHours()).toBe(18);
      expect(d.getUTCDate()).toBe(16);
    });
  });

  describe("getDayOfWeekInTimezone", () => {
    it("returns 1 (Monday) for 2025-03-17 in Asia/Dhaka", () => {
      expect(getDayOfWeekInTimezone("2025-03-17", 360)).toBe(1);
    });
    it("returns 0 (Sunday) for 2025-03-16 in Asia/Dhaka", () => {
      expect(getDayOfWeekInTimezone("2025-03-16", 360)).toBe(0);
    });
  });
});
