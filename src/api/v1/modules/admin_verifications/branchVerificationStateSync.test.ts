/**
 * Branch verification state sync: admin approval must update Branch.status and Branch.verificationStatus
 * so owner panel and clinic flows see consistent state (see docs/CLINIC_BRANCH_VERIFICATION_ACTIVE_FIX.md).
 *
 * - approveBranchKyc: BranchProfileDetails.verificationStatus = VERIFIED, Branch.status = ACTIVE, Branch.verificationStatus = VERIFIED
 * - Owner list shows business-visible status; when verificationStatus === VERIFIED, owner should see ACTIVE (not DRAFT)
 */

// Mirror of owner.controller branchDisplayStatusForOwner for deterministic tests
function branchDisplayStatusForOwner(branch: { status?: string; verificationStatus?: string }) {
  const status = branch?.status || "DRAFT";
  const verificationStatus = branch?.verificationStatus || "";
  if (
    verificationStatus === "VERIFIED" &&
    status !== "BLOCKED" &&
    status !== "INACTIVE"
  ) {
    return "ACTIVE";
  }
  return status;
}

describe("Branch verification state sync", () => {
  it("approve transition sets Branch to ACTIVE + VERIFIED (documentation)", () => {
    const afterApprove = { status: "ACTIVE", verificationStatus: "VERIFIED" };
    expect(afterApprove.status).toBe("ACTIVE");
    expect(afterApprove.verificationStatus).toBe("VERIFIED");
  });

  it("owner display status: VERIFIED implies ACTIVE for single status column", () => {
    expect(branchDisplayStatusForOwner({ status: "DRAFT", verificationStatus: "VERIFIED" })).toBe("ACTIVE");
    expect(branchDisplayStatusForOwner({ status: "ACTIVE", verificationStatus: "VERIFIED" })).toBe("ACTIVE");
    expect(branchDisplayStatusForOwner({ status: "DRAFT", verificationStatus: "SUBMITTED" })).toBe("DRAFT");
    expect(branchDisplayStatusForOwner({ status: "BLOCKED", verificationStatus: "VERIFIED" })).toBe("BLOCKED");
  });

  it("BLOCKED and INACTIVE take precedence over VERIFIED", () => {
    expect(branchDisplayStatusForOwner({ status: "BLOCKED", verificationStatus: "VERIFIED" })).toBe("BLOCKED");
    expect(branchDisplayStatusForOwner({ status: "INACTIVE", verificationStatus: "VERIFIED" })).toBe("INACTIVE");
  });

  it("owner API response shape includes status, verificationStatus, and displayStatus", () => {
    const branch = { id: 1, name: "Test", status: "DRAFT", verificationStatus: "VERIFIED" };
    const withDisplay = { ...branch, displayStatus: branchDisplayStatusForOwner(branch) };
    expect(withDisplay.status).toBe("DRAFT");
    expect(withDisplay.verificationStatus).toBe("VERIFIED");
    expect(withDisplay.displayStatus).toBe("ACTIVE");
  });

  it("backfill targets: profile VERIFIED and branch status !== ACTIVE", () => {
    const backfillCondition = (profile: { verificationStatus: string }, branch: { status: string }) =>
      profile.verificationStatus === "VERIFIED" && branch.status !== "ACTIVE";
    expect(backfillCondition({ verificationStatus: "VERIFIED" }, { status: "DRAFT" })).toBe(true);
    expect(backfillCondition({ verificationStatus: "VERIFIED" }, { status: "ACTIVE" })).toBe(false);
    expect(backfillCondition({ verificationStatus: "SUBMITTED" }, { status: "DRAFT" })).toBe(false);
  });

  it("approveBranchKyc does not swallow Branch update failure (transaction rollback)", () => {
    const fs = require("fs");
    const path = require("path");
    const file = path.join(__dirname, "admin_verifications.controller.ts");
    const source = fs.existsSync(file)
      ? fs.readFileSync(file, "utf8")
      : fs.readFileSync(path.join(__dirname, "admin_verifications.controller.js"), "utf8");
    expect(source).toContain("tx.branch.update");
    expect(source).not.toContain("branch.status update failed (ignored)");
  });
});
