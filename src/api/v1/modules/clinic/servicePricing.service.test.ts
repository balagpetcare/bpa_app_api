/**
 * Centralized pricing matrix — batch query wiring (mocked Prisma).
 * Run: npx jest servicePricing.service.test.ts
 */

const serviceFindMany = jest.fn();
const mappingFindMany = jest.fn();
const feeFindMany = jest.fn();
const profileFindMany = jest.fn();

jest.mock("../../../../infrastructure/db/prismaClient", () => {
  const client = {
    service: { findMany: (...a: unknown[]) => serviceFindMany(...a) },
    doctorServiceMapping: { findMany: (...a: unknown[]) => mappingFindMany(...a) },
    doctorServiceFee: { findMany: (...a: unknown[]) => feeFindMany(...a) },
    clinicStaffProfile: { findMany: (...a: unknown[]) => profileFindMany(...a) },
  };
  return Object.assign(client, { default: client });
});

const { getServicePricingMatrix } = require("./servicePricing.service");

describe("servicePricing.service — getServicePricingMatrix", () => {
  beforeEach(() => {
    serviceFindMany.mockReset();
    mappingFindMany.mockReset();
    feeFindMany.mockReset();
    profileFindMany.mockReset();
  });

  it("returns empty structure when branch has no services", async () => {
    serviceFindMany.mockResolvedValue([]);
    const out = await getServicePricingMatrix(101);
    expect(out).toEqual({ services: [], doctors: [], feeRows: [], mappings: [] });
    expect(mappingFindMany).not.toHaveBeenCalled();
  });

  it("aggregates fee min/max and pending ack count per service", async () => {
    serviceFindMany.mockResolvedValue([
      {
        id: 1,
        name: "Consult",
        category: "CONSULTATION",
        serviceCode: "C1",
        status: "ACTIVE",
        duration: 30,
        price: 100,
        baseCost: null,
        minSafePrice: null,
        staffInstructions: null,
        pricingExplanation: null,
        preparationNotes: null,
        aftercareNotes: null,
        visibleToPublic: true,
        pricingVariants: [],
      },
    ]);
    mappingFindMany.mockResolvedValue([
      {
        id: 10,
        branchId: 101,
        serviceId: 1,
        clinicStaffProfileId: 501,
        isAllowed: true,
        role: "PRIMARY",
        status: "ACTIVE",
        clinicStaffProfile: {
          id: 501,
          branchMemberId: 9001,
          branchMember: { user: { profile: { displayName: "Dr A" } } },
        },
        service: { id: 1, name: "Consult" },
      },
    ]);
    feeFindMany.mockResolvedValue([
      {
        id: 100,
        serviceId: 1,
        clinicStaffProfileId: 501,
        fee: 30,
        feeModel: "FIXED",
        feePercent: null,
        fixedAmount: null,
        durationMin: null,
        isActive: true,
        notes: null,
        species: null,
        pendingManagerChangeAt: new Date("2026-01-01T00:00:00.000Z"),
        doctorAcknowledgedAt: null,
        feeLockedByClinic: false,
        revisionNote: null,
        clinicStaffProfile: {
          id: 501,
          branchMemberId: 9001,
          branchMember: { user: { profile: { displayName: "Dr A" } } },
        },
      },
      {
        id: 101,
        serviceId: 1,
        clinicStaffProfileId: 502,
        fee: 40,
        feeModel: "FIXED",
        feePercent: null,
        fixedAmount: null,
        durationMin: null,
        isActive: true,
        notes: null,
        species: null,
        pendingManagerChangeAt: null,
        doctorAcknowledgedAt: null,
        feeLockedByClinic: false,
        revisionNote: null,
        clinicStaffProfile: {
          id: 502,
          branchMemberId: 9002,
          branchMember: { user: { profile: { displayName: "Dr B" } } },
        },
      },
    ]);
    profileFindMany.mockResolvedValue([
      {
        id: 501,
        branchMemberId: 9001,
        branchMember: { user: { profile: { displayName: "Dr A" } } },
      },
      {
        id: 502,
        branchMemberId: 9002,
        branchMember: { user: { profile: { displayName: "Dr B" } } },
      },
    ]);

    const out = await getServicePricingMatrix(101, { limit: 50 });

    expect(out.services).toHaveLength(1);
    expect(out.services[0].feeMin).toBe(30);
    expect(out.services[0].feeMax).toBe(40);
    expect(out.services[0].pendingAckCount).toBe(1);
    expect(out.services[0].assignedDoctorCount).toBe(1);
    expect(out.feeRows).toHaveLength(2);
    expect(out.feeRows.find((f: { id: number }) => f.id === 100).pendingAck).toBe(true);
    expect(out.mappings).toHaveLength(1);
    expect(out.doctors).toHaveLength(2);
  });
});
