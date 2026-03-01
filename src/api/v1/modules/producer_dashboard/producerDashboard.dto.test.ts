import { dashboardDateRangeSchema, dashboardTopProductsSchema } from "./producerDashboard.dto";

describe("producerDashboard.dto", () => {
  describe("dashboardDateRangeSchema", () => {
    it("accepts valid date range within 180 days", () => {
      const result = dashboardDateRangeSchema.safeParse({
        dateFrom: "2025-01-01",
        dateTo: "2025-01-31",
      });
      expect(result.success).toBe(true);
    });

    it("rejects dateTo before dateFrom", () => {
      const result = dashboardDateRangeSchema.safeParse({
        dateFrom: "2025-02-01",
        dateTo: "2025-01-15",
      });
      expect(result.success).toBe(false);
    });

    it("rejects date range exceeding 180 days", () => {
      const result = dashboardDateRangeSchema.safeParse({
        dateFrom: "2024-01-01",
        dateTo: "2024-07-31", // 212 days
      });
      expect(result.success).toBe(false);
    });

    it("accepts exactly 180 days", () => {
      const result = dashboardDateRangeSchema.safeParse({
        dateFrom: "2024-08-01",
        dateTo: "2025-01-28", // 180 days
      });
      expect(result.success).toBe(true);
    });

    it("rejects invalid date format", () => {
      const result = dashboardDateRangeSchema.safeParse({
        dateFrom: "01-01-2025",
        dateTo: "2025-01-31",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("dashboardTopProductsSchema", () => {
    it("accepts valid params with default limit", () => {
      const result = dashboardTopProductsSchema.safeParse({
        dateFrom: "2025-01-01",
        dateTo: "2025-01-31",
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.limit).toBe(10);
    });

    it("accepts limit in 1-50", () => {
      const result = dashboardTopProductsSchema.safeParse({
        dateFrom: "2025-01-01",
        dateTo: "2025-01-31",
        limit: 20,
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.limit).toBe(20);
    });

    it("rejects limit > 50", () => {
      const result = dashboardTopProductsSchema.safeParse({
        dateFrom: "2025-01-01",
        dateTo: "2025-01-31",
        limit: 51,
      });
      expect(result.success).toBe(false);
    });
  });
});
