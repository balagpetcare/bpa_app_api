import { PrismaClient } from "@prisma/client";

function normalizePhoneDigits(v: string) {
  return String(v || "").replace(/\D/g, "");
}

/**
 * Seeds Super Admin whitelist from env.
 *
 * Env:
 *  - SUPER_ADMIN_WHITELIST_EMAILS="owner@bpa.com,admin@bpa.com"
 *  - SUPER_ADMIN_WHITELIST_PHONES="88017XXXXXXXX,017XXXXXXXX"
 */
export default async function seedSuperAdminWhitelist(prisma: PrismaClient) {
  const emails = String(process.env.SUPER_ADMIN_WHITELIST_EMAILS || "")
    .split(",")
    .map((x) => String(x || "").trim().toLowerCase())
    .filter(Boolean);

  const phones = String(process.env.SUPER_ADMIN_WHITELIST_PHONES || "")
    .split(",")
    .map((x) => normalizePhoneDigits(String(x || "")))
    .filter(Boolean);

  if (!emails.length && !phones.length) return;

  const data: any[] = [];
  for (const email of emails) data.push({ email, isActive: true, note: "seed" });
  for (const phone of phones) data.push({ phone, isActive: true, note: "seed" });

  // Upsert one-by-one to keep uniqueness safe
  for (const row of data) {
    if (row.email) {
      await prisma.superAdminWhitelist.upsert({
        where: { email: row.email },
        update: { isActive: true },
        create: row,
      });
    } else if (row.phone) {
      await prisma.superAdminWhitelist.upsert({
        where: { phone: row.phone },
        update: { isActive: true },
        create: row,
      });
    }
  }
}
