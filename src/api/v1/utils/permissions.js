const prisma = require("../../../infrastructure/db/prismaClient");
const { isAdminAllowed } = require("../services/authUnified.service");

const ADMIN_PERMISSIONS = [
  "reports.read", "dashboard.view", "dashboard.read", "finance.read",
  "branch.read", "branch.write", "staff.read", "staff.write",
  "wallet.read", "wallet.withdraw_request.read", "wallet.withdraw.approve",
  "fundraising.read", "fundraising.verify", "users.read", "settings.write",
  "TEAM_MANAGE",
];

/**
 * Canonical permission keys (UI / menu expects these).
 * Backend may use plural forms (e.g. branches.read); this map adds canonical aliases
 * so nav filtering works without changing DB seeds.
 */
const PLURAL_TO_CANONICAL = {
  branches: "branch",
  products: "product",
};
function addCanonicalAliases(permSet) {
  const out = new Set(permSet);
  for (const key of permSet) {
    const [resource, action] = key.split(".");
    if (!resource || !action) continue;
    const canonical = PLURAL_TO_CANONICAL[resource];
    if (canonical) out.add(`${canonical}.${action}`);
    if (resource === "branch" && action === "write") out.add("branch.create");
    if (resource === "org" && action === "write") out.add("org.create");
    if (resource === "staff" && action === "write") out.add("staff.create");
    if (resource === "product" && action === "write") out.add("product.create");
    if (resource === "settings" && (action === "write" || action === "read")) out.add("settings.manage");
  }
  return out;
}

/**
 * Default permission matrix for legacy MemberRole enum.
 * This is used as a safe fallback until all org/branch members are assigned DB-backed roles.
 * Keys here use backend convention (branches.read); canonical aliases (branch.read) are added when resolving.
 */
/** @legacy Use context-based auth where possible. These feed compatibility layer. */
const LEGACY_ROLE_PERMS = {
  OWNER: [
    "org.read","org.write",
    "branches.read","branches.write",
    "staff.read","staff.write",
    "orders.read","orders.write",
    "inventory.read","inventory.write",
    "customers.read","customers.write",
    "reports.read","dashboard.view","finance.read",
    "settings.read","settings.write",
    "clinic.appointments.read","clinic.appointments.manage",
    "clinic.patients.read","clinic.patients.manage",
    "product.read","product.create","product.update","product.delete",
    "owner.products.manage"
  ],
  ORG_ADMIN: [
    "org.read","org.write",
    "branches.read","branches.write",
    "staff.read","staff.write",
    "orders.read","orders.write",
    "inventory.read","inventory.write",
    "customers.read","customers.write",
    "reports.read","dashboard.view","finance.read",
    "settings.read","settings.write"
  ],
  BRANCH_MANAGER: [
    "branches.read",
    "staff.read","staff.write",
    "orders.read","orders.write",
    "inventory.read","inventory.write",
    "customers.read","customers.write",
    "reports.read","dashboard.view"
  ],
  BRANCH_STAFF: [
    "branches.read",
    "orders.read","orders.write",
    "inventory.read",
    "customers.read",
    "reports.view"
  ],
  SELLER: [
    "orders.read","orders.write",
    "customers.read",
    "inventory.read"
  ],
  DELIVERY_MANAGER: [
    "orders.read","delivery.read","delivery.write"
  ],
  DELIVERY_STAFF: [
    "orders.read","delivery.read"
  ],
};

/**
 * Resolve permissions for a user across all memberships.
 * - Uses DB-backed roles if org_member_roles/branch_member_roles are populated
 * - Falls back to legacy OrgMember.role / BranchMember.role (MemberRole enum)
 */
async function resolvePermissionsForUser(userId) {
  if (!userId) return [];

  try {
    // 1) DB-backed roles via org_member_roles / branch_member_roles
    const [orgMembers, branchMembers, producerStaff, globalRoles, countryRoles, stateRoles] = await Promise.all([
      prisma.orgMember.findMany({
        where: { userId: Number(userId), status: "ACTIVE" },
        select: {
          id: true,
          role: true, // legacy
          roles: {
            select: {
              role: {
                select: {
                  key: true,
                  rolePermissions: { select: { permission: { select: { key: true } } } },
                },
              },
            },
          },
        },
      }),
      prisma.branchMember.findMany({
        where: { userId: Number(userId), status: "ACTIVE" },
        select: {
          id: true,
          branchId: true, // required for approvedBranchIds.has(m.branchId)
          role: true, // legacy
          roles: {
            select: {
              role: {
                select: {
                  key: true,
                  rolePermissions: { select: { permission: { select: { key: true } } } },
                },
              },
            },
          },
        },
      }),
      prisma.producerOrgStaff.findMany({
        where: { userId: Number(userId) },
        select: {
          role: {
            select: {
              key: true,
              rolePermissions: { select: { permission: { select: { key: true } } } },
            },
          },
        },
      }),
      prisma.userGlobalRole.findMany({
        where: { userId: Number(userId) },
        select: {
          role: {
            select: {
              key: true,
              rolePermissions: { select: { permission: { select: { key: true } } } },
            },
          },
        },
      }),
      prisma.userCountryRole.findMany({
        where: { userId: Number(userId) },
        select: {
          role: {
            select: {
              key: true,
              rolePermissions: { select: { permission: { select: { key: true } } } },
            },
          },
        },
      }),
      prisma.userStateRole.findMany({
        where: { userId: Number(userId) },
        select: {
          role: {
            select: {
              key: true,
              rolePermissions: { select: { permission: { select: { key: true } } } },
            },
          },
        },
      }),
    ]);

    // Check if user is an owner (for implicit staff access)
    const ownerProfile = await prisma.ownerProfile.findUnique({
      where: { userId: Number(userId) },
      select: { id: true },
    });

    const ownedOrgs = await prisma.organization.findMany({
      where: { ownerUserId: Number(userId) },
      select: { id: true },
    });

    const isOwner = Boolean(ownerProfile || ownedOrgs.length > 0);

    const out = new Set();

    // db-backed perms
    for (const m of orgMembers) {
      for (const r of (m.roles || [])) {
        for (const rp of (r.role.rolePermissions || [])) out.add(rp.permission.key);
      }
      // legacy fallback
      for (const p of (LEGACY_ROLE_PERMS[m.role] || [])) out.add(p);
    }

    // producer org staff perms
    for (const m of producerStaff) {
      const role = m.role;
      if (!role) continue;
      for (const rp of (role.rolePermissions || [])) out.add(rp.permission.key);
    }

    // global role perms
    for (const m of globalRoles) {
      const role = m.role;
      if (!role) continue;
      for (const rp of (role.rolePermissions || [])) out.add(rp.permission.key);
    }

    // country/state role perms
    for (const m of countryRoles) {
      const role = m.role;
      if (!role) continue;
      for (const rp of (role.rolePermissions || [])) out.add(rp.permission.key);
    }
    for (const m of stateRoles) {
      const role = m.role;
      if (!role) continue;
      for (const rp of (role.rolePermissions || [])) out.add(rp.permission.key);
    }

    // Load all APPROVED BranchAccessPermission for user (covers both branch members and BAP-only staff)
    let branchAccessPermissions = [];
    try {
      if (prisma.branchAccessPermission) {
        branchAccessPermissions = await prisma.branchAccessPermission.findMany({
          where: {
            userId: Number(userId),
            status: "APPROVED",
          },
          select: {
            branchId: true,
            expiresAt: true,
            role: true,
            permissionOverrides: true,
          },
        });
      }
    } catch (_) {
      // model may not exist
    }

    const now = new Date();
    const activeBranchAccess = branchAccessPermissions.filter((ap) => {
      if (!ap.expiresAt) return true;
      return new Date(ap.expiresAt) > now;
    });
    const approvedBranchIds = new Set(activeBranchAccess.map((ap) => ap.branchId));

    let BRANCH_ROLE_PERMISSIONS;
    let BRANCH_DEFAULT_ROLE;
    try {
      const branchRoles = require("../constants/branchRoles");
      BRANCH_ROLE_PERMISSIONS = branchRoles.BRANCH_ROLE_PERMISSIONS || {};
      BRANCH_DEFAULT_ROLE = branchRoles.BRANCH_DEFAULT_ROLE || "BRANCH_STAFF";
    } catch (_) {
      BRANCH_ROLE_PERMISSIONS = {};
      BRANCH_DEFAULT_ROLE = "BRANCH_STAFF";
    }

    // Only process branch members with approved access (or owners who have implicit access)
    for (const m of branchMembers) {
      const hasAccess = isOwner || approvedBranchIds.has(m.branchId);

      if (hasAccess) {
        for (const r of (m.roles || [])) {
          for (const rp of (r.role.rolePermissions || [])) out.add(rp.permission.key);
        }
        for (const p of (LEGACY_ROLE_PERMS[m.role] || [])) out.add(p);
        for (const p of (BRANCH_ROLE_PERMISSIONS[m.role] || [])) out.add(p);
      }
    }

    // Grant permissions from each active BranchAccessPermission (covers BAP-only users who have no BranchMember)
    for (const ap of activeBranchAccess) {
      const member = branchMembers.find((m) => m.branchId === ap.branchId);
      const roleKey =
        (member && (member.roles?.[0]?.role?.key || member.role)) ||
        ap.role ||
        BRANCH_DEFAULT_ROLE;
      const basePerms = BRANCH_ROLE_PERMISSIONS[roleKey] || [];
      for (const p of basePerms) out.add(p);
      const overridesRaw = ap.permissionOverrides;
      const overrides = Array.isArray(overridesRaw)
        ? overridesRaw.filter((k) => typeof k === "string")
        : [];
      for (const p of overrides) out.add(p);
    }

    // Fallback: if user has any active branch access or membership but got no permissions, grant minimal so dashboard/reports work
    if ((branchMembers.length > 0 || activeBranchAccess.length > 0) && out.size === 0) {
      out.add("branches.read");
      out.add("org.read");
      out.add("reports.view");
    }

    // If user is an owner, add OWNER permissions (implicit staff access to all org branches)
    if (isOwner) {
      for (const p of (LEGACY_ROLE_PERMS.OWNER || [])) out.add(p);
    }

    // Team management: only users who own at least one OwnerTeam get TEAM_MANAGE (not delegates)
    try {
      const ownedTeamsCount = await prisma.ownerTeam.count({
        where: { ownerUserId: Number(userId) },
      });
      if (ownedTeamsCount > 0) out.add("TEAM_MANAGE");
    } catch (_e) {
      // ignore if schema not migrated
    }

    // SuperAdminWhitelist admins get full admin permissions (reports, dashboard, etc.)
    try {
      if (await isAdminAllowed(Number(userId))) {
        for (const p of ADMIN_PERMISSIONS) out.add(p);
      }
    } catch (_e) {
      // Ignore if check fails
    }

    const withAliases = addCanonicalAliases(out);
    return Array.from(withAliases);
  } catch (e) {
    // If DB isn't migrated yet or model fields don't exist, fail closed to legacy-only by trying simple membership fetch
    try {
      const [orgMembers2, branchMembers2] = await Promise.all([
        prisma.orgMember.findMany({
          where: { userId: Number(userId), status: "ACTIVE" },
          select: { role: true },
        }),
        prisma.branchMember.findMany({
          where: { userId: Number(userId), status: "ACTIVE" },
          select: { role: true, branchId: true },
        }),
      ]);

      const out = new Set();
      for (const m of orgMembers2) for (const p of (LEGACY_ROLE_PERMS[m.role] || [])) out.add(p);

      // Check branch access permissions in fallback mode: load all APPROVED BAP for user (same as main path)
      try {
        let branchAccessPermissions2 = [];
        if (prisma.branchAccessPermission) {
          branchAccessPermissions2 = await prisma.branchAccessPermission.findMany({
            where: { userId: Number(userId), status: "APPROVED" },
            select: { branchId: true, expiresAt: true, role: true, permissionOverrides: true },
          });
        }
        const now2 = new Date();
        const activeBranchAccess2 = branchAccessPermissions2.filter((ap) => {
          if (!ap.expiresAt) return true;
          return new Date(ap.expiresAt) > now2;
        });
        const approvedBranchIds2 = new Set(activeBranchAccess2.map((ap) => ap.branchId));

        const ownerProfile2 = await prisma.ownerProfile.findUnique({
          where: { userId: Number(userId) },
          select: { id: true },
        });
        const ownedOrgs2 = await prisma.organization.findMany({
          where: { ownerUserId: Number(userId) },
          select: { id: true },
        });
        const isOwner2 = Boolean(ownerProfile2 || ownedOrgs2.length > 0);

        for (const m of branchMembers2) {
          const hasAccess = isOwner2 || approvedBranchIds2.has(m.branchId);
          if (hasAccess) {
            for (const p of (LEGACY_ROLE_PERMS[m.role] || [])) out.add(p);
          }
        }

        // BAP-only: grant permissions from each active BAP (align with main path)
        let BRANCH_ROLE_PERMISSIONS2 = {};
        let BRANCH_DEFAULT_ROLE2 = "BRANCH_STAFF";
        try {
          const branchRoles = require("../constants/branchRoles");
          BRANCH_ROLE_PERMISSIONS2 = branchRoles.BRANCH_ROLE_PERMISSIONS || {};
          BRANCH_DEFAULT_ROLE2 = branchRoles.BRANCH_DEFAULT_ROLE || "BRANCH_STAFF";
        } catch (_) {}
        for (const ap of activeBranchAccess2) {
          const member = branchMembers2.find((m) => m.branchId === ap.branchId);
          const roleKey =
            (member && member.role) || ap.role || BRANCH_DEFAULT_ROLE2;
          for (const p of (BRANCH_ROLE_PERMISSIONS2[roleKey] || [])) out.add(p);
          const overridesRaw = ap.permissionOverrides;
          const overrides = Array.isArray(overridesRaw) ? overridesRaw.filter((k) => typeof k === "string") : [];
          for (const p of overrides) out.add(p);
        }

        if ((branchMembers2.length > 0 || activeBranchAccess2.length > 0) && out.size === 0) {
          out.add("branches.read");
          out.add("org.read");
          out.add("reports.view");
        }
      } catch (_e3) {
        for (const m of branchMembers2) for (const p of (LEGACY_ROLE_PERMS[m.role] || [])) out.add(p);
      }

      const withAliases = addCanonicalAliases(out);
      return Array.from(withAliases);
    } catch (_e2) {
      return [];
    }
  }
}

/** Trust & Safety / Enforcement permission keys (admin panel). */
const ENFORCEMENT_CASES = "admin.governance.enforcement.cases";
const ENFORCEMENT_ACTIONS = "admin.governance.enforcement.actions";

module.exports = { resolvePermissionsForUser, LEGACY_ROLE_PERMS, ENFORCEMENT_CASES, ENFORCEMENT_ACTIONS };
