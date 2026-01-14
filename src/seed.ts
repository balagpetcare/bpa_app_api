import dotenv from "dotenv";
import { prisma } from "./lib/prisma";
import { hashPassword } from "./lib/auth";

dotenv.config();

const PERMS = [
  { code: "partner.application.read", label: "Read partner applications" },
  { code: "partner.application.approve", label: "Approve/reject partner applications" },
  { code: "branch.publish.read", label: "Read branch publish requests" },
  { code: "branch.publish.approve", label: "Approve/reject branch publish requests" },
];

const ROLES = [
  {
    code: "SUPER_ADMIN",
    label: "Super Admin",
    perms: PERMS.map((p) => p.code),
  },
  {
    code: "BPA_ADMIN",
    label: "BPA Admin",
    perms: PERMS.map((p) => p.code),
  },
  {
    code: "ORG_OWNER",
    label: "Organization Owner",
    perms: [],
  },
  {
    code: "BRANCH_MANAGER",
    label: "Branch Manager",
    perms: [],
  },
  {
    code: "STAFF",
    label: "Staff",
    perms: [],
  },
  {
    code: "DELIVERY_MANAGER",
    label: "Delivery Manager",
    perms: [],
  },
  {
    code: "DELIVERY_STAFF",
    label: "Delivery Staff",
    perms: [],
  },
];

async function upsertPermissions() {
  for (const p of PERMS) {
    await prisma.permission.upsert({
      where: { code: p.code },
      update: { label: p.label },
      create: { code: p.code, label: p.label },
    });
  }
}

async function upsertRoles() {
  for (const r of ROLES) {
    const role = await prisma.role.upsert({
      where: { code: r.code },
      update: { label: r.label },
      create: { code: r.code, label: r.label },
    });

    // sync role permissions for roles that have perms declared
    if (r.perms.length) {
      const permRows = await prisma.permission.findMany({ where: { code: { in: r.perms } } });
      await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
      await prisma.rolePermission.createMany({
        data: permRows.map((p) => ({ roleId: role.id, permissionId: p.id })),
        skipDuplicates: true,
      });
    }
  }
}

async function ensureSuperAdmin() {
  const phone = process.env.SUPER_ADMIN_PHONE;
  const password = process.env.SUPER_ADMIN_PASSWORD;
  if (!phone || !password) {
    // eslint-disable-next-line no-console
    console.log("SUPER_ADMIN_PHONE / SUPER_ADMIN_PASSWORD not set. Skipping super admin creation.");
    return;
  }

  const role = await prisma.role.findUnique({ where: { code: "SUPER_ADMIN" } });
  if (!role) throw new Error("SUPER_ADMIN role missing. Run seed again.");

  const user = await prisma.user.upsert({
    where: { phone },
    update: {},
    create: {
      phone,
      passwordHash: await hashPassword(password),
      status: "ACTIVE",
      partnerStatus: "NOT_APPLIED",
      authIdentities: { create: { provider: "LOCAL" } },
    },
  });

  await prisma.userPlatformRole.upsert({
    where: { userId_roleId: { userId: user.id, roleId: role.id } },
    update: {},
    create: { userId: user.id, roleId: role.id },
  });

  // eslint-disable-next-line no-console
  console.log(`Super admin ensured: ${phone}`);
}

async function main() {
  await upsertPermissions();
  await upsertRoles();
  await ensureSuperAdmin();
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
