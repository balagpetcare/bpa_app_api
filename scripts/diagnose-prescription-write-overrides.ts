/**
 * Read-only report: find BranchAccessPermission rows that still reference clinic.prescription.write
 * and flag veterinarians who would fail clinic Rx authoring (create/edit/finalize) after write is retired.
 *
 * Run: npm run diagnose:prescription-write-overrides
 *      npx ts-node --compiler-options "{\"module\":\"CommonJS\"}" scripts/diagnose-prescription-write-overrides.ts
 *
 * Requires DATABASE_URL. Does not modify data.
 */
import { PrismaClient } from "@prisma/client";
import {
  BRANCH_DEFAULT_PERMISSIONS,
  BRANCH_DEFAULT_ROLE,
  BRANCH_ROLE_PERMISSIONS,
} from "../src/api/v1/constants/branchRoles";

const WRITE = "clinic.prescription.write";
const GRANULAR = [
  "clinic.prescription.create",
  "clinic.prescription.edit",
  "clinic.prescription.finalize",
] as const;

function extractOverrideKeys(raw: unknown): { keys: string[]; shape: "array" | "object" | "empty" | "invalid" } {
  if (raw == null) return { keys: [], shape: "empty" };
  if (Array.isArray(raw)) {
    const keys = raw.filter((k): k is string => typeof k === "string");
    return { keys, shape: "array" };
  }
  if (typeof raw === "object" && !Array.isArray(raw)) {
    return { keys: Object.keys(raw as Record<string, unknown>), shape: "object" };
  }
  return { keys: [], shape: "invalid" };
}

function resolveRoleKey(member: {
  role: string | null;
  roles: { role: { key: string } }[];
} | null): string {
  if (!member) return BRANCH_DEFAULT_ROLE;
  const fromJoin = member.roles?.[0]?.role?.key;
  return fromJoin || (member.role as string) || BRANCH_DEFAULT_ROLE;
}

function effectivePermissions(roleKey: string, overrideKeys: string[]): string[] {
  const base =
    BRANCH_ROLE_PERMISSIONS[roleKey] || BRANCH_DEFAULT_PERMISSIONS;
  return [...new Set([...base, ...overrideKeys])];
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.branchAccessPermission.findMany({
      select: {
        id: true,
        branchId: true,
        userId: true,
        status: true,
        permissionOverrides: true,
      },
    });

    const jsonHasWrite = (raw: unknown): boolean => {
      const s = JSON.stringify(raw);
      return s.includes(WRITE);
    };

    const candidates = rows.filter((r) => r.permissionOverrides != null && jsonHasWrite(r.permissionOverrides));

    let suspiciousSubstringOnly = 0;

    console.log("[diagnose-prescription-write] === Prescription write override report ===\n");
    console.log(`Total BranchAccessPermission rows scanned: ${rows.length}`);
    console.log(`Rows whose permissionOverrides JSON mentions "${WRITE}": ${candidates.length}\n`);

    const approvedAtRisk: {
      id: number;
      branchId: number;
      userId: number;
      staffType: string | null;
      roleKey: string;
      shape: string;
      missingGranular: string[];
      note: string;
    }[] = [];

    const needsManualObjectFix: typeof approvedAtRisk = [];

    for (const r of candidates) {
      const { keys: overrideKeys, shape } = extractOverrideKeys(r.permissionOverrides);
      const member = await prisma.branchMember.findUnique({
        where: { branchId_userId: { branchId: r.branchId, userId: r.userId } },
        select: {
          status: true,
          role: true,
          roles: { select: { role: { select: { key: true } } } },
          clinicStaffProfile: { select: { staffType: true } },
        },
      });

      const roleKey = resolveRoleKey(member);
      const perms = effectivePermissions(roleKey, overrideKeys);
      const hasWrite = perms.includes(WRITE);
      if (jsonHasWrite(r.permissionOverrides) && !hasWrite) suspiciousSubstringOnly++;
      const missingGranular = GRANULAR.filter((g) => !perms.includes(g));
      const isDoctor = member?.clinicStaffProfile?.staffType === "DOCTOR";
      const activeMember = member?.status === "ACTIVE";

      const noteParts: string[] = [];
      if (r.status !== "APPROVED") noteParts.push(`status=${r.status}`);
      if (!activeMember) noteParts.push("branchMember not ACTIVE");
      if (shape === "object" && hasWrite) {
        noteParts.push("object-shaped overrides — migrate script skips; convert to string[] or edit in admin");
      }
      if (shape === "invalid") noteParts.push("invalid JSON shape for overrides");

      if (r.status === "APPROVED" && shape === "object" && hasWrite) {
        needsManualObjectFix.push({
          id: r.id,
          branchId: r.branchId,
          userId: r.userId,
          staffType: member?.clinicStaffProfile?.staffType ?? null,
          roleKey,
          shape,
          missingGranular,
          note: noteParts.join("; ") || "object keys include write",
        });
      }

      if (
        r.status === "APPROVED" &&
        activeMember &&
        isDoctor &&
        hasWrite &&
        missingGranular.length > 0
      ) {
        approvedAtRisk.push({
          id: r.id,
          branchId: r.branchId,
          userId: r.userId,
          staffType: member?.clinicStaffProfile?.staffType ?? null,
          roleKey,
          shape,
          missingGranular,
          note: noteParts.join("; ") || "",
        });
      }
    }

    if (needsManualObjectFix.length) {
      console.log("--- ACTION: Object-shaped overrides (migration script does NOT auto-fix) ---\n");
      for (const x of needsManualObjectFix) {
        console.log(
          JSON.stringify({
            branchAccessPermissionId: x.id,
            branchId: x.branchId,
            userId: x.userId,
            staffType: x.staffType,
            branchRole: x.roleKey,
            missingGranular: x.missingGranular,
            note: x.note,
          })
        );
      }
      console.log("");
    }

    if (approvedAtRisk.length === 0) {
      console.log("--- APPROVED + ACTIVE doctor rows missing granular keys while still relying on write: 0 ---");
      console.log("(No veterinarian would lose clinic API Rx permission solely due to write retirement,");
      console.log(" given current DB — or write appears only in non-APPROVED/inactive rows.)\n");
    } else {
      console.log(
        "--- AT RISK: APPROVED access, ACTIVE member, DOCTOR staffType, has write in overrides, missing granular ---\n"
      );
      for (const x of approvedAtRisk) {
        console.log(
          JSON.stringify({
            branchAccessPermissionId: x.id,
            branchId: x.branchId,
            userId: x.userId,
            staffType: x.staffType,
            branchRole: x.roleKey,
            overrideShape: x.shape,
            missingGranular: x.missingGranular,
            note: x.note,
          })
        );
      }
      console.log("\nRun: npm run migrate:prescription-write-overrides (array overrides only)\n");
    }

    const approvedArrayMigratable = candidates.filter((r) => {
      if (r.status !== "APPROVED") return false;
      const { shape, keys } = extractOverrideKeys(r.permissionOverrides);
      return shape === "array" && keys.includes(WRITE);
    });

    console.log(`--- Summary ---`);
    console.log(`Rows eligible for migrate-prescription-write-overrides (APPROVED + array + contains write): ${approvedArrayMigratable.length}`);
    console.log(`Rows needing manual fix (object JSON with write): ${needsManualObjectFix.length}`);
    console.log(`Doctor + APPROVED + ACTIVE + missing granular after write ignored: ${approvedAtRisk.length}`);
    if (suspiciousSubstringOnly > 0) {
      console.log(
        `Note: ${suspiciousSubstringOnly} row(s) mention "${WRITE}" in JSON text but it is not an effective permission key (nested value?) — inspect manually.`
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
