/**
 * Unit tests for list price / doctor fee resolution helpers.
 * Run: npx jest servicePricingResolution.service.test.ts
 */

const mockProfileFindFirst = jest.fn();
const mockServiceFindFirst = jest.fn();
const mockDoctorFeeFindFirst = jest.fn();

jest.mock("../../../../infrastructure/db/prismaClient", () => ({
  default: {
    clinicStaffProfile: { findFirst: (...a: unknown[]) => mockProfileFindFirst(...a) },
    service: { findFirst: (...a: unknown[]) => mockServiceFindFirst(...a) },
    doctorServiceFee: { findFirst: (...a: unknown[]) => mockDoctorFeeFindFirst(...a) },
  },
}));

const {
  resolveServiceListPriceFromRows,
  computeDoctorFeeAmountFromRow,
  resolveDoctorServiceFeeAmount,
} = require("./servicePricingResolution.service");

describe("servicePricingResolution.service", () => {
  beforeEach(() => {
    mockProfileFindFirst.mockReset();
    mockServiceFindFirst.mockReset();
    mockDoctorFeeFindFirst.mockReset();
  });

  describe("resolveServiceListPriceFromRows", () => {
    it("uses Service.price when no variants match", () => {
      expect(
        resolveServiceListPriceFromRows(
          { price: 100, pricingVariants: [{ species: "CANINE", sex: null, price: 200, isActive: true }] },
          { species: "FELINE" }
        )
      ).toBe(100);
    });

    it("uses variant when species and sex match", () => {
      expect(
        resolveServiceListPriceFromRows(
          {
            price: 100,
            pricingVariants: [
              { species: "CANINE", sex: "MALE", price: 150, isActive: true },
              { species: "CANINE", sex: null, price: 120, isActive: true },
            ],
          },
          { species: "CANINE", sex: "MALE" }
        )
      ).toBe(150);
    });

    it("falls back to variant with null sex when patient sex unknown", () => {
      expect(
        resolveServiceListPriceFromRows(
          {
            price: 100,
            pricingVariants: [{ species: "CANINE", sex: null, price: 130, isActive: true }],
          },
          { species: "CANINE", sex: null }
        )
      ).toBe(130);
    });
  });

  describe("computeDoctorFeeAmountFromRow", () => {
    it("FIXED uses fixedAmount when set else fee", () => {
      expect(computeDoctorFeeAmountFromRow({ fee: 40, feeModel: "FIXED", fixedAmount: 55 }, 200)).toBe(55);
      expect(computeDoctorFeeAmountFromRow({ fee: 40, feeModel: "FIXED" }, 200)).toBe(40);
    });

    it("PERCENT_OF_LIST uses list price", () => {
      expect(computeDoctorFeeAmountFromRow({ fee: 0, feeModel: "PERCENT_OF_LIST", feePercent: 25 }, 200)).toBe(50);
    });

    it("HYBRID adds fixed and percent", () => {
      expect(
        computeDoctorFeeAmountFromRow({ fee: 10, feeModel: "HYBRID", fixedAmount: 10, feePercent: 10 }, 200)
      ).toBe(30);
    });
  });

  describe("resolveDoctorServiceFeeAmount", () => {
    it("returns null when no doctor profile for branch member", async () => {
      mockProfileFindFirst.mockResolvedValue(null);
      const r = await resolveDoctorServiceFeeAmount({
        branchId: 1,
        branchMemberId: 99,
        serviceId: 5,
        species: null,
      });
      expect(r).toEqual({ amount: null, profileId: null, feeRowId: null });
    });

    it("resolves percent fee against list price from service row", async () => {
      mockProfileFindFirst.mockResolvedValue({ id: 7 });
      mockServiceFindFirst.mockResolvedValue({
        id: 5,
        branchId: 1,
        price: 100,
        pricingVariants: [],
      });
      mockDoctorFeeFindFirst.mockResolvedValue({
        id: 22,
        fee: 0,
        feeModel: "PERCENT_OF_LIST",
        feePercent: 20,
        fixedAmount: null,
        isActive: true,
      });

      const r = await resolveDoctorServiceFeeAmount({
        branchId: 1,
        branchMemberId: 3,
        serviceId: 5,
        species: null,
      });

      expect(r.profileId).toBe(7);
      expect(r.feeRowId).toBe(22);
      expect(r.amount).toBe(20);
    });
  });
});
