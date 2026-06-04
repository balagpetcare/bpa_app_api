import "dotenv/config";
import prisma from "../src/infrastructure/db/prismaClient";

function normalizePhone(v: string | null | undefined) {
  const digits = String(v || "").replace(/\D/g, "");
  if (!digits) return null;
  return digits.length > 11 ? digits.slice(-11) : digits;
}

function normalizeEmail(v: string | null | undefined) {
  const s = String(v || "").trim().toLowerCase();
  return s || null;
}

function parseCsv(raw: string | undefined) {
  return String(raw || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

async function main() {
  const emails = Array.from(
    new Set([
      normalizeEmail(process.env.SUPER_ADMIN_EMAIL),
      ...parseCsv(process.env.SUPER_ADMIN_WHITELIST_EMAILS).map(normalizeEmail),
    ].filter(Boolean) as string[])
  );
  const phones = Array.from(
    new Set([
      ...parseCsv(process.env.SUPER_ADMIN_PHONE).map(normalizePhone),
      ...parseCsv(process.env.SUPER_ADMIN_WHITELIST_PHONES).map(normalizePhone),
    ].filter(Boolean) as string[])
  );

  const authRows = await prisma.userAuth.findMany({
    where: {
      OR: [
        ...emails.map((email) => ({ email: { equals: email, mode: "insensitive" as const } })),
        ...phones.map((phone) => ({ phone })),
      ],
    },
    select: {
      id: true,
      userId: true,
      email: true,
      phone: true,
      passwordHash: true,
      user: { select: { status: true, profile: { select: { displayName: true, username: true } } } },
    },
    orderBy: { id: "asc" },
  });

  const role = await prisma.role.findUnique({
    where: { key: "SUPER_ADMIN" },
    select: {
      id: true,
      key: true,
      rolePermissions: { select: { permission: { select: { key: true } } } },
    },
  });
  const roleLinks = role
    ? await prisma.userGlobalRole.findMany({
        where: { roleId: role.id, userId: { in: authRows.map((row) => row.userId) } },
        select: { userId: true, roleId: true, createdAt: true },
      })
    : [];

  const whitelist = await prisma.superAdminWhitelist.findMany({
    where: {
      OR: [
        ...emails.map((email) => ({ email: { equals: email, mode: "insensitive" as const } })),
        ...phones.map((phone) => ({ phone })),
      ],
    },
    select: { id: true, email: true, phone: true, isActive: true, note: true },
    orderBy: { id: "asc" },
  });

  console.log(
    JSON.stringify(
      {
        queried: { emails, phones },
        authUsers: authRows.map((row) => ({
          id: row.id,
          userId: row.userId,
          email: row.email,
          phone: row.phone,
          hasPasswordHash: Boolean(row.passwordHash),
          status: row.user?.status,
          displayName: row.user?.profile?.displayName,
          username: row.user?.profile?.username,
          hasSuperAdminRole: roleLinks.some((link) => link.userId === row.userId),
        })),
        whitelist,
        superAdminRoleExists: Boolean(role),
        superAdminPermissions: role?.rolePermissions.map((rp) => rp.permission.key) ?? [],
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
