/**
 * requireClinicPermission: dispense route must reject callers without medicine.dispense.issue.
 */
const branchFindFirst = jest.fn();
const resolveBranchAccessProfile = jest.fn();

/** Match real prismaClient: CJS `require()` is the client; `.default` is the same instance. */
jest.mock("../../../../infrastructure/db/prismaClient", () => {
  const client = { branch: { findFirst: (...a: unknown[]) => branchFindFirst(...a) } };
  return Object.assign(client, { default: client });
});

jest.mock("../../services/branchAccessPermission.service", () => ({
  resolveBranchAccessProfile: (...args: unknown[]) => resolveBranchAccessProfile(...args),
}));

const { requireClinicPermission } = require("./clinic.middleware");

function runMw(mw: any, req: any) {
  return new Promise<{ status?: number; next: boolean }>((resolve) => {
    const res: any = {
      statusCode: 0,
      status(n: number) {
        this.statusCode = n;
        return this;
      },
      json() {
        resolve({ status: this.statusCode, next: false });
        return this;
      },
    };
    mw(req, res, () => resolve({ next: true }));
  });
}

describe("requireClinicPermission — prescription dispense gate", () => {
  beforeEach(() => {
    branchFindFirst.mockReset();
    resolveBranchAccessProfile.mockReset();
  });

  it("returns 403 when profile lacks medicine.dispense.issue", async () => {
    branchFindFirst.mockResolvedValue({
      id: 5,
      orgId: 1,
      name: "Clinic",
      featuresJson: { clinicEnabled: true },
    });
    resolveBranchAccessProfile.mockResolvedValue({
      status: "APPROVED",
      permissions: ["clinic.prescription.read", "clinic.emr.write"],
    });
    const mw = requireClinicPermission("medicine.dispense.issue");
    const req: any = { user: { id: 42 }, params: { branchId: "5" } };
    const r = await runMw(mw, req);
    expect(r.next).toBe(false);
    expect(r.status).toBe(403);
  });

  it("calls next when profile includes medicine.dispense.issue", async () => {
    branchFindFirst.mockResolvedValue({
      id: 5,
      orgId: 1,
      name: "Clinic",
      featuresJson: { clinicEnabled: true },
    });
    resolveBranchAccessProfile.mockResolvedValue({
      status: "APPROVED",
      permissions: ["medicine.dispense.issue"],
    });
    const mw = requireClinicPermission("medicine.dispense.issue");
    const req: any = { user: { id: 42 }, params: { branchId: "5" } };
    const r = await runMw(mw, req);
    expect(r.next).toBe(true);
    expect(req.clinicBranchId).toBe(5);
  });
});
