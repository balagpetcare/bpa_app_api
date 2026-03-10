/**
 * Guardrail: role/permission ↔ sidebar gating consistency.
 * Fails when sidebar permission keys are not registered or not present in any clinic role mapping.
 * Run: npm test -- src/api/v1/constants/sidebarPermissionKeys.test.ts
 */

const {
  BRANCH_SIDEBAR_PERMISSION_KEYS,
  CLINIC_SIDEBAR_PERMISSION_KEYS,
  CLINIC_CONTEXT_ROLES,
} = require("./sidebarPermissionKeys");
const { getGroupedRegistry } = require("../services/permissionsRegistry.service");
const branchRoles = require("./branchRoles");

function getRegistryKeys() {
  const groups = getGroupedRegistry();
  const keys = new Set();
  for (const { permissions } of groups) {
    for (const p of permissions) keys.add(p.key);
  }
  return keys;
}

function getClinicRolePermissions() {
  const perms = new Set();
  const rolePerms = branchRoles.BRANCH_ROLE_PERMISSIONS;
  for (const role of CLINIC_CONTEXT_ROLES) {
    const list = rolePerms[role];
    if (Array.isArray(list)) for (const p of list) perms.add(p);
  }
  return perms;
}

describe("sidebar permission keys guardrail", () => {
  const registryKeys = getRegistryKeys();
  const clinicRolePerms = getClinicRolePermissions();

  test("every branch sidebar permission key is registered in permissionsRegistry", () => {
    const missing = BRANCH_SIDEBAR_PERMISSION_KEYS.filter((k) => !registryKeys.has(k));
    expect(missing).toEqual([]);
  });

  test("every clinic sidebar permission key is in at least one clinic context role (CLINIC_STAFF or BRANCH_MANAGER)", () => {
    const missing = CLINIC_SIDEBAR_PERMISSION_KEYS.filter((k) => !clinicRolePerms.has(k));
    expect(missing).toEqual([]);
  });
});
