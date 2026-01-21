// @ts-nocheck
import { PrismaClient } from "@prisma/client";

type SeedPermission = { key: string; description?: string };
type SeedRole = { key: string; name: string; permissions: string[] };

const PERMS: SeedPermission[] = [
  { key: "dashboard.read", description: "View dashboard" },
  { key: "org.read", description: "Read organization settings" },
  { key: "org.write", description: "Update organization settings" },
  { key: "branch.read", description: "Read branches" },
  { key: "branch.write", description: "Create/update branches" },
  { key: "staff.read", description: "Read staff users" },
  { key: "staff.write", description: "Create/update staff users" },
  { key: "role.read", description: "Read roles and permissions" },
  { key: "role.write", description: "Create/update roles and permissions" },
  { key: "audit.read", description: "Read audit logs" },
];

const DEFAULT_ROLES: SeedRole[] = [
  {
    key: "OWNER",
    name: "Owner",
    permissions: [
      "dashboard.read",
      "org.read",
      "org.write",
      "branch.read",
      "branch.write",
      "staff.read",
      "staff.write",
      "role.read",
      "role.write",
      "audit.read",
    ],
  },
  {
    key: "ADMIN",
    name: "Admin",
    permissions: [
      "dashboard.read",
      "org.read",
      "branch.read",
      "branch.write",
      "staff.read",
      "staff.write",
      "role.read",
      "role.write",
      "audit.read",
    ],
  },
  {
    key: "BRANCH_MANAGER",
    name: "Branch Manager",
    permissions: ["dashboard.read", "branch.read", "branch.write", "staff.read"],
  },
  {
    key: "STAFF",
    name: "Staff",
    permissions: ["dashboard.read", "branch.read"],
  },
];

/**
 * Call this from your main seed.
 * 
 * Example:
 *   const prisma = new PrismaClient();
 *   await seedPhase0Foundation(prisma);
 */
export async function seedPhase0Foundation(prisma: PrismaClient) {
  // 1) Permissions
  for (const p of PERMS) {
    await prisma.permission.upsert({
      where: { key: p.key },
      update: { description: p.description },
      create: { key: p.key, description: p.description },
    });
  }

  // 2) Default Organization (optional)
  const org = await prisma.organization.upsert({
    where: { slug: "demo-org" },
    update: {},
    create: { name: "Demo Organization", slug: "demo-org" },
  });

  // 3) Default roles + role permissions per org
  const permMap = new Map(
    (await prisma.permission.findMany()).map((x) => [x.key, x.id] as const)
  );

  for (const r of DEFAULT_ROLES) {
    const role = await prisma.role.upsert({
      where: { orgId_key: { orgId: org.id, key: r.key } },
      update: { name: r.name },
      create: { orgId: org.id, key: r.key, name: r.name },
    });

    // ensure role permissions
    for (const permKey of r.permissions) {
      const permId = permMap.get(permKey);
      if (!permId) continue;
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permId } },
        update: {},
        create: { roleId: role.id, permissionId: permId },
      });
    }
  }

  // 4) Sample branches + capabilities (optional demo data)
  const hq = await prisma.branch.upsert({
    where: { orgId_code: { orgId: org.id, code: "HQ" } },
    update: {},
    create: { orgId: org.id, name: "HQ Branch", code: "HQ", address: "Dhaka (demo)" },
  });

  const clinicShop = await prisma.branch.upsert({
    where: { orgId_code: { orgId: org.id, code: "CS-01" } },
    update: {},
    create: { orgId: org.id, name: "Clinic + Shop", code: "CS-01", address: "Dhaka (demo)" },
  });

  // capabilities
  await prisma.branchCapabilityLink.upsert({
    where: { branchId_capability: { branchId: hq.id, capability: "hq_warehouse" } },
    update: {},
    create: { branchId: hq.id, capability: "hq_warehouse" },
  });

  for (const cap of ["clinic", "shop", "online_sales"] as const) {
    await prisma.branchCapabilityLink.upsert({
      where: { branchId_capability: { branchId: clinicShop.id, capability: cap } },
      update: {},
      create: { branchId: clinicShop.id, capability: cap },
    });
  }

  console.log("✅ Phase-0 foundation seed completed.");
}

// If you want to run this file directly:
if (require.main === module) {
  const prisma = new PrismaClient();
  seedPhase0Foundation(prisma)
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}