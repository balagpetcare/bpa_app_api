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
    "customers.read"
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
    const [orgMembers, branchMembers, producerStaff, countryRoles, stateRoles] = await Promise.all([
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

    // Check branch access permissions for branch members
    // Only grant permissions if staff has APPROVED access to the branch
    const branchAccessPermissions = await prisma.branchAccessPermission.findMany({
      where: {
        userId: Number(userId),
        branchId: { in: branchMembers.map((m) => m.branchId || 0).filter(Boolean) },
        status: "APPROVED",
      },
      select: {
        branchId: true,
        expiresAt: true,
      },
    });

    // Filter out expired permissions
    const now = new Date();
    const activeBranchAccess = branchAccessPermissions.filter((ap) => {
      if (!ap.expiresAt) return true; // No expiration
      return new Date(ap.expiresAt) > now;
    });

    const approvedBranchIds = new Set(activeBranchAccess.map((ap) => ap.branchId));

    // Only process branch members with approved access (or owners who have implicit access)
    for (const m of branchMembers) {
      // Owners have implicit access to all their org branches
      const hasAccess = isOwner || approvedBranchIds.has(m.branchId);

      if (hasAccess) {
        for (const r of (m.roles || [])) {
          for (const rp of (r.role.rolePermissions || [])) out.add(rp.permission.key);
        }
        // legacy fallback
        for (const p of (LEGACY_ROLE_PERMS[m.role] || [])) out.add(p);
      }
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
          select: { role: true },
        }),
      ]);

      const out = new Set();
      for (const m of orgMembers2) for (const p of (LEGACY_ROLE_PERMS[m.role] || [])) out.add(p);

      // Check branch access permissions in fallback mode too
      try {
        const branchAccessPermissions2 = await prisma.branchAccessPermission.findMany({
          where: {
            userId: Number(userId),
            branchId: { in: branchMembers2.map((m) => m.branchId || 0).filter(Boolean) },
            status: "APPROVED",
          },
          select: {
            branchId: true,
            expiresAt: true,
          },
        });

        const now2 = new Date();
        const activeBranchAccess2 = branchAccessPermissions2.filter((ap) => {
          if (!ap.expiresAt) return true;
          return new Date(ap.expiresAt) > now2;
        });

        const approvedBranchIds2 = new Set(activeBranchAccess2.map((ap) => ap.branchId));

        // Check if user is owner
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
      } catch (_e3) {
        // If branch access check fails, fall back to granting all branch member permissions
        // This maintains backward compatibility
        for (const m of branchMembers2) for (const p of (LEGACY_ROLE_PERMS[m.role] || [])) out.add(p);
      }

      const withAliases = addCanonicalAliases(out);
      return Array.from(withAliases);
    } catch (_e2) {
      return [];
    }
  }
}

module.exports = { resolvePermissionsForUser, LEGACY_ROLE_PERMS };
