/**
 * Authoring routes require granular keys only — clinic.prescription.write must not satisfy create/edit/finalize gates.
 */
const branchFindFirst = jest.fn();
const resolveBranchAccessProfile = jest.fn();

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

function clinicBranchOk() {
  branchFindFirst.mockResolvedValue({
    id: 5,
    orgId: 1,
    name: "Clinic",
    featuresJson: { clinicEnabled: true },
  });
}

describe("requireClinicPermission — prescription authoring (write retired)", () => {
  beforeEach(() => {
    branchFindFirst.mockReset();
    resolveBranchAccessProfile.mockReset();
    clinicBranchOk();
  });

  it.each([
    ["clinic.prescription.create", "POST .../visits/:visitId/prescriptions"],
    ["clinic.prescription.edit", "PATCH .../prescriptions/:id"],
    ["clinic.prescription.finalize", "POST .../prescriptions/:id/finalize"],
  ])("%s: legacy write alone does not pass", async (requiredPerm) => {
    resolveBranchAccessProfile.mockResolvedValue({
      status: "APPROVED",
      permissions: ["clinic.prescription.read", "clinic.prescription.write", "clinic.emr.write"],
    });
    const mw = requireClinicPermission(requiredPerm);
    const req: any = { user: { id: 1 }, params: { branchId: "5" } };
    const r = await runMw(mw, req);
    expect(r.next).toBe(false);
    expect(r.status).toBe(403);
  });

  it.each([
    ["clinic.prescription.create"],
    ["clinic.prescription.edit"],
    ["clinic.prescription.finalize"],
  ])("%s: granular key passes permission gate (middleware stack still enforces DOCTOR elsewhere)", async (requiredPerm) => {
    resolveBranchAccessProfile.mockResolvedValue({
      status: "APPROVED",
      permissions: [requiredPerm, "clinic.prescription.read"],
    });
    const mw = requireClinicPermission(requiredPerm);
    const req: any = { user: { id: 1 }, params: { branchId: "5" } };
    const r = await runMw(mw, req);
    expect(r.next).toBe(true);
    expect(req.clinicBranchId).toBe(5);
  });
});
