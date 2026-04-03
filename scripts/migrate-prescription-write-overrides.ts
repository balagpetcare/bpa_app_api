/**
 * One-time (idempotent) migration: replace clinic.prescription.write in BranchAccessPermission.permissionOverrides
 * (array form) with clinic.prescription.create, .edit, .finalize so vets keep clinic API access after write is retired from routes.
 *
 * Run: npm run migrate:prescription-write-overrides
 *
 * Does not modify object-shaped permissionOverrides (rare); fix those manually in admin/DB.
 */
import { PrismaClient } from "@prisma/client";

const WRITE = "clinic.prescription.write";
const REPLACEMENTS = [
  "clinic.prescription.create",
  "clinic.prescription.edit",
  "clinic.prescription.finalize",
] as const;

async function main() {
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.branchAccessPermission.findMany({
      where: { status: "APPROVED", permissionOverrides: { not: null } },
      select: { id: true, branchId: true, userId: true, permissionOverrides: true },
    });

    let updated = 0;
    for (const r of rows) {
      const raw = r.permissionOverrides;
      if (!Array.isArray(raw) || !raw.every((x) => typeof x === "string")) continue;
      const arr = raw as string[];
      if (!arr.includes(WRITE)) continue;

      const next = [...new Set([...arr.filter((k) => k !== WRITE), ...REPLACEMENTS])];
      await prisma.branchAccessPermission.update({
        where: { id: r.id },
        data: { permissionOverrides: next },
      });
      console.log(
        `[migrate-prescription-write] id=${r.id} branchId=${r.branchId} userId=${r.userId} replaced ${WRITE} with granular keys`
      );
      updated++;
    }

    console.log(`[migrate-prescription-write] done. Updated ${updated} row(s).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
