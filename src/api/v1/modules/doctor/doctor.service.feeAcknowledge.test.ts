/**
 * Doctor service fee acknowledgment writes change log and clears pending state.
 * Run: npx jest doctor.service.feeAcknowledge.test.ts
 */

const branchMemberFindFirst = jest.fn();
const doctorServiceFeeFindFirst = jest.fn();
const doctorServiceFeeUpdate = jest.fn();
const doctorServiceFeeFindUnique = jest.fn();
const doctorServiceFeeFindMany = jest.fn();
const doctorServiceFeeChangeLogCreate = jest.fn();
const doctorServiceMappingFindMany = jest.fn();
const branchFindUnique = jest.fn();
const doctorAuditLogCreate = jest.fn();

jest.mock("../../../../infrastructure/db/prismaClient", () => {
  const client = {
    branchMember: { findFirst: (...a: unknown[]) => branchMemberFindFirst(...a) },
    doctorServiceFee: {
      findFirst: (...a: unknown[]) => doctorServiceFeeFindFirst(...a),
      update: (...a: unknown[]) => doctorServiceFeeUpdate(...a),
      findUnique: (...a: unknown[]) => doctorServiceFeeFindUnique(...a),
      findMany: (...a: unknown[]) => doctorServiceFeeFindMany(...a),
    },
    doctorServiceFeeChangeLog: { create: (...a: unknown[]) => doctorServiceFeeChangeLogCreate(...a) },
    doctorServiceMapping: { findMany: (...a: unknown[]) => doctorServiceMappingFindMany(...a) },
    branch: { findUnique: (...a: unknown[]) => branchFindUnique(...a) },
    doctorAuditLog: { create: (...a: unknown[]) => doctorAuditLogCreate(...a) },
  };
  return Object.assign(client, { default: client });
});

jest.mock("../clinic/appointments/appointmentStateMachine", () => ({
  assertTransition: jest.fn(),
}));

jest.mock("./doctorNotification.service", () => ({}));

const { acknowledgeMyServiceFeeChange, getMyServices } = require("./doctor.service");

describe("doctor.service — acknowledgeMyServiceFeeChange", () => {
  beforeEach(() => {
    branchMemberFindFirst.mockReset();
    doctorServiceFeeFindFirst.mockReset();
    doctorServiceFeeUpdate.mockReset();
    doctorServiceFeeFindUnique.mockReset();
    doctorServiceFeeFindMany.mockReset();
    doctorServiceFeeChangeLogCreate.mockReset();
    doctorServiceMappingFindMany.mockReset();
    branchFindUnique.mockReset();
    doctorAuditLogCreate.mockReset();
  });

  function mockDoctorContext() {
    branchMemberFindFirst.mockResolvedValue({
      id: 55,
      branchId: 2,
      userId: 900,
      clinicStaffProfile: { id: 501, staffType: "DOCTOR" },
    });
  }

  it("throws 400 when no pending manager change", async () => {
    mockDoctorContext();
    doctorServiceFeeFindFirst.mockResolvedValue({
      id: 10,
      clinicStaffProfileId: 501,
      serviceId: 3,
      species: null,
      fee: 50,
      feeModel: "FIXED",
      feePercent: null,
      fixedAmount: null,
      pendingManagerChangeAt: null,
      doctorAcknowledgedAt: null,
      service: { id: 3, price: 100, pricingVariants: [] },
    });

    await expect(acknowledgeMyServiceFeeChange(900, 2, { serviceId: 3 })).rejects.toMatchObject({
      message: "No pending change to acknowledge",
    });
    expect(doctorServiceFeeUpdate).not.toHaveBeenCalled();
    expect(doctorServiceFeeChangeLogCreate).not.toHaveBeenCalled();
  });

  it("updates row, appends change log, and writes doctor audit log", async () => {
    mockDoctorContext();
    const pendingAt = new Date("2026-02-01T12:00:00.000Z");
    doctorServiceFeeFindFirst.mockResolvedValue({
      id: 10,
      clinicStaffProfileId: 501,
      serviceId: 3,
      species: null,
      fee: 50,
      feeModel: "FIXED",
      feePercent: null,
      fixedAmount: null,
      pendingManagerChangeAt: pendingAt,
      pendingManagerChangeByUserId: 1,
      doctorAcknowledgedAt: null,
      service: { id: 3, price: 100, pricingVariants: [] },
    });
    doctorServiceFeeUpdate.mockResolvedValue({});
    doctorServiceFeeFindUnique.mockResolvedValue({
      id: 10,
      clinicStaffProfileId: 501,
      serviceId: 3,
      species: null,
      fee: 50,
      feeModel: "FIXED",
      feePercent: null,
      fixedAmount: null,
      pendingManagerChangeAt: null,
      pendingManagerChangeByUserId: null,
      doctorAcknowledgedAt: new Date("2026-02-02T00:00:00.000Z"),
      doctorAcknowledgedByUserId: 900,
      lastAgreedAt: new Date("2026-02-02T00:00:00.000Z"),
      lastAgreedFee: 50,
      feeLockedByClinic: false,
      revisionNote: null,
      durationMin: null,
      isActive: true,
      notes: null,
    });
    branchFindUnique.mockResolvedValue({ orgId: 77 });
    doctorServiceFeeFindMany.mockResolvedValue([]);
    doctorServiceMappingFindMany.mockResolvedValue([]);

    await acknowledgeMyServiceFeeChange(900, 2, { serviceId: 3 });

    expect(doctorServiceFeeUpdate).toHaveBeenCalledTimes(1);
    expect(doctorServiceFeeChangeLogCreate).toHaveBeenCalledTimes(1);
    const logArg = doctorServiceFeeChangeLogCreate.mock.calls[0][0];
    expect(logArg.data.doctorServiceFeeId).toBe(10);
    expect(logArg.data.actorUserId).toBe(900);
    expect(logArg.data.changeReason).toBe("DOCTOR_SERVICE_FEE_ACKNOWLEDGED");
    expect(logArg.data.beforeJson).toMatchObject({ pendingManagerChangeAt: pendingAt.toISOString() });
    expect(logArg.data.afterJson.pendingManagerChangeAt).toBeNull();

    expect(doctorAuditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "SERVICE_FEE_ACKNOWLEDGED" }),
      })
    );
  });
});

describe("doctor.service — getMyServices (smoke with mocks)", () => {
  beforeEach(() => {
    branchMemberFindFirst.mockReset();
    doctorServiceFeeFindMany.mockReset();
    doctorServiceMappingFindMany.mockReset();
  });

  it("returns null when not a doctor member", async () => {
    branchMemberFindFirst.mockResolvedValue(null);
    const r = await getMyServices(1, 2);
    expect(r).toBeNull();
  });
});
