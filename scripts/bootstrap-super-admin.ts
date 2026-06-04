import "dotenv/config";
import bcrypt from "bcrypt";
import prisma from "../src/infrastructure/db/prismaClient";

function normalizeEmail(v: string | null | undefined) {
  const s = String(v || "").trim().toLowerCase();
  return s || null;
}

function normalizePhone(v: string | null | undefined) {
  const digits = String(v || "").replace(/\D/g, "");
  if (!digits) return null;
  return digits.length > 11 ? digits.slice(-11) : digits;
}

function parseCsv(raw: string | undefined) {
  return String(raw || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

async function generateUniqueUsername(email: string | null, phone: string | null, displayName: string) {
  let base =
    (email ? email.split("@")[0] : "") ||
    (phone ? `user${phone}` : "") ||
    displayName.toLowerCase().replace(/\s+/g, "") ||
    "user";

  base = base.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 20) || "user";

  let username = base;
  for (let i = 0; i < 10; i += 1) {
    const existing = await prisma.userProfile.findFirst({ where: { username }, select: { id: true } });
    if (!existing) return username;
    username = `${base}_${Math.floor(1000 + Math.random() * 9000)}`.slice(0, 30);
  }

  return `user_${Date.now()}`;
}

async function ensureSuperAdminRole() {
  const permission = await prisma.permission.upsert({
    where: { key: "global.admin" },
    update: { label: "Global admin", description: "Full platform access" },
    create: { key: "global.admin", label: "Global admin", description: "Full platform access" },
  });

  const role = await prisma.role.upsert({
    where: { key: "SUPER_ADMIN" },
    update: { label: "Super Admin", scope: "GLOBAL", isSystem: true },
    create: { key: "SUPER_ADMIN", label: "Super Admin", scope: "GLOBAL", isSystem: true },
  });

  await prisma.rolePermission.upsert({
    where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
    update: {},
    create: { roleId: role.id, permissionId: permission.id },
  });

  return role;
}

async function ensureWhitelist(email: string | null, phone: string | null) {
  if (email) {
    await prisma.superAdminWhitelist.upsert({
      where: { email },
      update: { isActive: true, note: "bootstrap-super-admin" },
      create: { email, isActive: true, note: "bootstrap-super-admin" },
    });
  }

  if (phone) {
    await prisma.superAdminWhitelist.upsert({
      where: { phone },
      update: { isActive: true, note: "bootstrap-super-admin" },
      create: { phone, isActive: true, note: "bootstrap-super-admin" },
    });
  }
}

async function findAuthForIdentity(email: string | null, phone: string | null) {
  return prisma.userAuth.findFirst({
    where: {
      OR: [
        email ? { email: { equals: email, mode: "insensitive" as const } } : undefined,
        phone ? { phone } : undefined,
      ].filter(Boolean) as any[],
    },
    include: { user: { include: { profile: true, wallet: true } } },
  });
}

async function ensureSuperAdminUser(params: {
  email: string | null;
  phone: string | null;
  password: string;
  displayName: string;
  roleId: number;
}) {
  const auth = await findAuthForIdentity(params.email, params.phone);
  const passwordHash = await bcrypt.hash(params.password, 10);

  if (auth?.user) {
    const user = await prisma.user.update({
      where: { id: auth.userId },
      data: {
        status: "ACTIVE",
        auth: {
          update: {
            provider: "LOCAL",
            email: params.email ?? auth.email,
            phone: params.phone ?? auth.phone,
            passwordHash,
            passwordUpdatedAt: new Date(),
          },
        },
        profile: {
          upsert: {
            update: { displayName: auth.user.profile?.displayName || params.displayName },
            create: {
              displayName: params.displayName,
              username: await generateUniqueUsername(params.email, params.phone, params.displayName),
            },
          },
        },
        wallet: auth.user.wallet
          ? undefined
          : { create: { balance: 0, points: 0, tier: "Bronze", currency: "BDT" } },
      },
      include: { auth: true, profile: true },
    });

    await prisma.userGlobalRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: params.roleId } },
      update: {},
      create: { userId: user.id, roleId: params.roleId },
    });

    return { user, action: "updated" };
  }

  const user = await prisma.user.create({
    data: {
      status: "ACTIVE",
      auth: {
        create: {
          provider: "LOCAL",
          email: params.email,
          phone: params.phone,
          passwordHash,
          passwordUpdatedAt: new Date(),
        },
      },
      profile: {
        create: {
          displayName: params.displayName,
          username: await generateUniqueUsername(params.email, params.phone, params.displayName),
        },
      },
      wallet: { create: { balance: 0, points: 0, tier: "Bronze", currency: "BDT" } },
      globalRoles: { create: { roleId: params.roleId } },
    },
    include: { auth: true, profile: true },
  });

  return { user, action: "created" };
}

function configuredSuperAdmins() {
  const phones = parseCsv(process.env.SUPER_ADMIN_PHONE)
    .flatMap((value) => parseCsv(value))
    .map((x) => normalizePhone(x))
    .filter(Boolean) as string[];
  const whitelistPhones = parseCsv(process.env.SUPER_ADMIN_WHITELIST_PHONES)
    .map((x) => normalizePhone(x))
    .filter(Boolean) as string[];
  const emails = [
    normalizeEmail(process.env.SUPER_ADMIN_EMAIL),
    ...parseCsv(process.env.SUPER_ADMIN_WHITELIST_EMAILS).map((x) => normalizeEmail(x)),
  ].filter(Boolean) as string[];

  const uniquePhones = Array.from(new Set([...phones, ...whitelistPhones]));
  const uniqueEmails = Array.from(new Set(emails));

  if (uniquePhones.length === 0 && uniqueEmails.length === 0) {
    throw new Error("SUPER_ADMIN_PHONE, SUPER_ADMIN_EMAIL, or whitelist env values are required");
  }

  const count = Math.max(uniquePhones.length, uniqueEmails.length);
  return Array.from({ length: count }, (_, index) => ({
    phone: uniquePhones[index] ?? null,
    email: uniqueEmails[index] ?? null,
  })).filter((row) => row.phone || row.email);
}

async function main() {
  const password = process.env.SUPER_ADMIN_PASSWORD;
  if (!password) throw new Error("SUPER_ADMIN_PASSWORD is required");

  const role = await ensureSuperAdminRole();
  const admins = configuredSuperAdmins();
  const results = [];

  for (const admin of admins) {
    await ensureWhitelist(admin.email, admin.phone);
    const result = await ensureSuperAdminUser({
      email: admin.email,
      phone: admin.phone,
      password,
      displayName: process.env.SUPER_ADMIN_NAME || "BPA Super Admin",
      roleId: role.id,
    });
    results.push({
      action: result.action,
      userId: result.user.id,
      email: result.user.auth?.email ?? null,
      phone: result.user.auth?.phone ?? null,
    });
  }

  console.log(JSON.stringify({ success: true, role: role.key, admins: results }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
