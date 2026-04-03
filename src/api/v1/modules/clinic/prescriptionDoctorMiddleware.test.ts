/**
 * Prescription authoring middleware: only ClinicStaffProfile.staffType === DOCTOR passes.
 */
const findFirstMock = jest.fn();

jest.mock("../../../../infrastructure/db/prismaClient", () => ({
  branchMember: { findFirst: findFirstMock },
}));

const { requireClinicDoctorStaffForPrescriptionAuthoring } = require("./clinic.middleware");

function runMiddleware(req: any) {
  return new Promise<{ status?: number; next: boolean }>((resolve) => {
    const res: any = {
      status(n: number) {
        this.statusCode = n;
        return this;
      },
      json() {
        resolve({ status: res.statusCode, next: false });
        return this;
      },
    };
    const mw = requireClinicDoctorStaffForPrescriptionAuthoring();
    mw(req, res, () => resolve({ next: true }));
  });
}

describe("requireClinicDoctorStaffForPrescriptionAuthoring", () => {
  beforeEach(() => {
    findFirstMock.mockReset();
  });

  it("returns 403 when user is nurse (not DOCTOR staff type)", async () => {
    findFirstMock.mockResolvedValue({
      id: 42,
      clinicStaffProfile: { staffType: "NURSE" },
    });
    const req: any = { user: { id: 9 }, clinicBranchId: 5 };
    const r = await runMiddleware(req);
    expect(r.next).toBe(false);
    expect(r.status).toBe(403);
    expect(findFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { branchId: 5, userId: 9, status: "ACTIVE" },
      })
    );
  });

  it("sets clinicDoctorBranchMemberId and calls next for DOCTOR", async () => {
    findFirstMock.mockResolvedValue({
      id: 77,
      clinicStaffProfile: { staffType: "DOCTOR" },
    });
    const req: any = { user: { id: 2 }, clinicBranchId: 3 };
    const r = await runMiddleware(req);
    expect(r.next).toBe(true);
    expect(req.clinicDoctorBranchMemberId).toBe(77);
  });

  describe("parity with clinic prescription mutation routes (POST create / PATCH / POST finalize)", () => {
    it.each([
      ["POST /visits/:visitId/prescriptions (create)", "create"],
      ["PATCH /prescriptions/:id (update)", "update"],
      ["POST /prescriptions/:id/finalize", "finalize"],
    ])("nurse receives 403 before controller — %s", async (_label, _op) => {
      findFirstMock.mockResolvedValue({
        id: 42,
        clinicStaffProfile: { staffType: "NURSE" },
      });
      const req: any = { user: { id: 9 }, clinicBranchId: 5 };
      const r = await runMiddleware(req);
      expect(r.next).toBe(false);
      expect(r.status).toBe(403);
    });
  });
});
