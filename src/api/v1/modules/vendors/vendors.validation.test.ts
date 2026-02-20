/**
 * Unit tests for Vendor validation (create, update, status, attachment).
 * Covers schema acceptance of string-like ids (orgId as number) and required fields.
 */
import {
  createVendorSchema,
  updateVendorSchema,
  vendorStatusSchema,
  addAttachmentSchema,
} from "./vendors.validation";

describe("vendors.validation", () => {
  describe("createVendorSchema", () => {
    it("accepts minimal payload with orgId and name", () => {
      const result = createVendorSchema.safeParse({ orgId: 1, name: "ABC Traders" });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.name).toBe("ABC Traders");
    });

    it("accepts orgId as number (id sent as string is parsed by controller)", () => {
      const result = createVendorSchema.safeParse({
        orgId: 1,
        name: "Vendor",
        code: "VEN-0001",
        phone: "+8801712345678",
        email: "v@example.com",
      });
      expect(result.success).toBe(true);
    });

    it("rejects missing name", () => {
      const result = createVendorSchema.safeParse({ orgId: 1, name: "" });
      expect(result.success).toBe(false);
    });

    it("rejects missing orgId", () => {
      const result = createVendorSchema.safeParse({ name: "Vendor" });
      expect(result.success).toBe(false);
    });

    it("rejects invalid vendorType", () => {
      const result = createVendorSchema.safeParse({
        orgId: 1,
        name: "V",
        vendorType: "INVALID",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("vendorStatusSchema", () => {
    it("accepts ACTIVE, INACTIVE, BLACKLISTED", () => {
      expect(vendorStatusSchema.safeParse({ status: "ACTIVE" }).success).toBe(true);
      expect(vendorStatusSchema.safeParse({ status: "INACTIVE" }).success).toBe(true);
      expect(vendorStatusSchema.safeParse({ status: "BLACKLISTED" }).success).toBe(true);
    });

    it("rejects invalid status", () => {
      expect(vendorStatusSchema.safeParse({ status: "PENDING" }).success).toBe(false);
    });
  });

  describe("addAttachmentSchema", () => {
    it("accepts fileKey only", () => {
      const result = addAttachmentSchema.safeParse({ fileKey: "minio/bucket/key.pdf" });
      expect(result.success).toBe(true);
    });

    it("rejects empty fileKey", () => {
      expect(addAttachmentSchema.safeParse({ fileKey: "" }).success).toBe(false);
    });
  });

  describe("updateVendorSchema", () => {
    it("accepts partial update with name", () => {
      const result = updateVendorSchema.safeParse({ name: "New Name" });
      expect(result.success).toBe(true);
    });

    it("accepts empty numeric fields and coerces to null (regression: PATCH with form empty values)", () => {
      const result = updateVendorSchema.safeParse({
        name: "Vendor",
        defaultPaymentTermsDays: "",
        creditLimit: "",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.defaultPaymentTermsDays).toBeNull();
        expect(result.data.creditLimit).toBeNull();
      }
    });

    it("accepts numeric strings and coerces to number", () => {
      const result = updateVendorSchema.safeParse({
        name: "Vendor",
        defaultPaymentTermsDays: "30",
        creditLimit: "1000",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.defaultPaymentTermsDays).toBe(30);
        expect(result.data.creditLimit).toBe(1000);
      }
    });
  });
});
