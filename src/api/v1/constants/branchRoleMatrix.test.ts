/**
 * Minimal tests for staff invite role rules (branchRoleMatrix).
 * Run: npx ts-node src/api/v1/constants/branchRoleMatrix.test.ts
 */

const assert = require("assert");
const {
  normalizeRole,
  canInviteRole,
  getInviteableRolesForInviter,
  getAllowedInviteRolesForBranch,
} = require("./branchRoleMatrix");

const shopBranch = { types: [{ type: { code: "SHOP" } }] };
const deliveryBranch = { types: [{ type: { code: "DELIVERY_HUB" } }] };

function run() {
  // Normalize: STAFF -> BRANCH_STAFF, uppercase
  assert.strictEqual(normalizeRole("STAFF"), "BRANCH_STAFF");
  assert.strictEqual(normalizeRole("branch_manager"), "BRANCH_MANAGER");

  // Branch manager inviting staff -> allowed
  const r1 = canInviteRole("BRANCH_MANAGER", "BRANCH_STAFF", shopBranch);
  assert.strictEqual(r1.allowed, true, "Branch manager inviting staff should be 200");

  // Branch manager inviting branch manager -> 403
  const r2 = canInviteRole("BRANCH_MANAGER", "BRANCH_MANAGER", shopBranch);
  assert.strictEqual(r2.allowed, false, "Branch manager inviting branch manager should be 403");
  assert.ok(
    (r2.message || "").toLowerCase().includes("cannot invite"),
    "Message should mention branch manager cannot invite"
  );

  // Owner inviting branch manager -> allowed
  const r3 = canInviteRole("OWNER", "BRANCH_MANAGER", shopBranch);
  assert.strictEqual(r3.allowed, true, "Owner inviting branch manager should be 200");

  // Invalid role for branch type -> 400 (e.g. DELIVERY_MANAGER for SHOP)
  const r4 = canInviteRole("OWNER", "DELIVERY_MANAGER", shopBranch);
  assert.strictEqual(r4.allowed, false, "DELIVERY_MANAGER for SHOP branch should be invalid");
  assert.ok(
    (r4.message || "").toLowerCase().includes("branch type"),
    "Message should mention branch type"
  );

  // Manager can only invite Staff/Seller for shop
  const managerRoles = getInviteableRolesForInviter("BRANCH_MANAGER", shopBranch);
  assert.ok(managerRoles.includes("BRANCH_STAFF") && managerRoles.includes("SELLER"));
  assert.ok(!managerRoles.includes("BRANCH_MANAGER"));

  // Owner gets all allowed for branch type
  const ownerRoles = getInviteableRolesForInviter("OWNER", shopBranch);
  assert.ok(ownerRoles.includes("BRANCH_MANAGER") && ownerRoles.includes("BRANCH_STAFF") && ownerRoles.includes("SELLER"));

  // Allowed roles for delivery hub
  const deliveryAllowed = getAllowedInviteRolesForBranch(deliveryBranch);
  assert.ok(deliveryAllowed.includes("DELIVERY_MANAGER") && deliveryAllowed.includes("DELIVERY_STAFF"));

  console.log("All branchRoleMatrix tests passed.");
}

run();
