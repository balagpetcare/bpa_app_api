import "dotenv/config";
import fs from "fs";
import path from "path";
import prisma from "../src/infrastructure/db/prismaClient";

const locationService = require("../src/modules/location/location.service");

function asIntOrNull(v: any): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.trunc(n);
}

async function buildAreaToUnionResolver(prismaClient: any) {
  const areas = await prismaClient.bdArea.findMany({
    select: { id: true, code: true, type: true, unionId: true },
  });
  const unions = prismaClient.bdUnion && typeof prismaClient.bdUnion.findMany === "function"
    ? await prismaClient.bdUnion.findMany({ select: { id: true, code: true } })
    : [];
  const unionByCode = new Map(unions.map((u: any) => [String(u.code), Number(u.id)]));
  const areaById = new Map(areas.map((a: any) => [Number(a.id), a]));

  return (areaIdRaw: any) => {
    const areaId = asIntOrNull(areaIdRaw);
    if (!areaId) return null;
    const area = areaById.get(areaId);
    if (!area) return null;
    if (area.unionId) return Number(area.unionId);
    if (String(area.type || "").toUpperCase() === "UNION") {
      return unionByCode.get(String(area.code)) || null;
    }
    return null;
  };
}

async function normalizeSelection(selection: any) {
  const validated = await locationService.validateSelection(prisma as any, selection);
  if (!validated?.ok) return null;
  return validated.normalized;
}

async function migrateUserProfiles(resolveUnionFromArea: (areaId: any) => number | null) {
  const rows = await prisma.userProfile.findMany({
    select: { id: true, divisionId: true, districtId: true, upazilaId: true, unionId: true, areaId: true, addressJson: true },
  });
  let updated = 0;
  for (const row of rows) {
    const addr = row.addressJson && typeof row.addressJson === "object" ? (row.addressJson as any) : {};
    const areaId = row.areaId ?? asIntOrNull(addr.bdAreaId) ?? asIntOrNull(addr.areaId);
    const normalized = await normalizeSelection({
      divisionId: row.divisionId ?? asIntOrNull(addr.divisionId),
      districtId: row.districtId ?? asIntOrNull(addr.districtId),
      upazilaId: row.upazilaId ?? asIntOrNull(addr.upazilaId),
      unionId: row.unionId ?? asIntOrNull(addr.unionId) ?? resolveUnionFromArea(areaId),
      areaId,
    });
    if (!normalized) continue;
    if (
      row.divisionId === normalized.divisionId &&
      row.districtId === normalized.districtId &&
      row.upazilaId === normalized.upazilaId &&
      row.unionId === normalized.unionId &&
      row.areaId === normalized.areaId
    ) {
      continue;
    }
    await prisma.userProfile.update({
      where: { id: row.id },
      data: {
        divisionId: normalized.divisionId,
        districtId: normalized.districtId,
        upazilaId: normalized.upazilaId,
        unionId: normalized.unionId,
        areaId: normalized.areaId,
      },
    });
    updated += 1;
  }
  return { scanned: rows.length, updated };
}

async function migrateOwnerProfiles(resolveUnionFromArea: (areaId: any) => number | null) {
  const rows = await prisma.ownerProfile.findMany({
    select: { id: true, divisionId: true, districtId: true, upazilaId: true, unionId: true, areaId: true, addressJson: true },
  });
  let updated = 0;
  for (const row of rows) {
    const addr = row.addressJson && typeof row.addressJson === "object" ? row.addressJson as any : {};
    const normalized = await normalizeSelection({
      divisionId: row.divisionId ?? asIntOrNull(addr.divisionId),
      districtId: row.districtId ?? asIntOrNull(addr.districtId),
      upazilaId: row.upazilaId ?? asIntOrNull(addr.upazilaId),
      unionId: row.unionId ?? asIntOrNull(addr.unionId) ?? resolveUnionFromArea(row.areaId ?? addr.bdAreaId ?? addr.areaId),
      areaId: row.areaId ?? asIntOrNull(addr.bdAreaId) ?? asIntOrNull(addr.areaId),
    });
    if (!normalized) continue;
    if (
      row.divisionId === normalized.divisionId &&
      row.districtId === normalized.districtId &&
      row.upazilaId === normalized.upazilaId &&
      row.unionId === normalized.unionId &&
      row.areaId === normalized.areaId
    ) {
      continue;
    }
    await prisma.ownerProfile.update({
      where: { id: row.id },
      data: {
        divisionId: normalized.divisionId,
        districtId: normalized.districtId,
        upazilaId: normalized.upazilaId,
        unionId: normalized.unionId,
        areaId: normalized.areaId,
      },
    });
    updated += 1;
  }
  return { scanned: rows.length, updated };
}

async function migrateOrganizations(resolveUnionFromArea: (areaId: any) => number | null) {
  const rows = await prisma.organization.findMany({
    select: { id: true, divisionId: true, districtId: true, upazilaId: true, unionId: true, areaId: true, addressJson: true },
  });
  let updated = 0;
  for (const row of rows) {
    const addr = row.addressJson && typeof row.addressJson === "object" ? row.addressJson as any : {};
    const areaId = row.areaId ?? asIntOrNull(addr.bdAreaId) ?? asIntOrNull(addr.areaId);
    const normalized = await normalizeSelection({
      divisionId: row.divisionId ?? asIntOrNull(addr.divisionId),
      districtId: row.districtId ?? asIntOrNull(addr.districtId),
      upazilaId: row.upazilaId ?? asIntOrNull(addr.upazilaId),
      unionId: row.unionId ?? asIntOrNull(addr.unionId) ?? resolveUnionFromArea(areaId),
      areaId,
    });
    if (!normalized) continue;
    if (
      row.divisionId === normalized.divisionId &&
      row.districtId === normalized.districtId &&
      row.upazilaId === normalized.upazilaId &&
      row.unionId === normalized.unionId &&
      row.areaId === normalized.areaId
    ) {
      continue;
    }
    await prisma.organization.update({
      where: { id: row.id },
      data: {
        divisionId: normalized.divisionId,
        districtId: normalized.districtId,
        upazilaId: normalized.upazilaId,
        unionId: normalized.unionId,
        areaId: normalized.areaId,
      },
    });
    updated += 1;
  }
  return { scanned: rows.length, updated };
}

async function migrateBranches(resolveUnionFromArea: (areaId: any) => number | null) {
  const rows = await prisma.branch.findMany({
    select: { id: true, divisionId: true, districtId: true, upazilaId: true, unionId: true, areaId: true, addressJson: true },
  });
  let updated = 0;
  for (const row of rows) {
    const addr = row.addressJson && typeof row.addressJson === "object" ? row.addressJson as any : {};
    const areaId = row.areaId ?? asIntOrNull(addr.bdAreaId) ?? asIntOrNull(addr.areaId);
    const normalized = await normalizeSelection({
      divisionId: row.divisionId ?? asIntOrNull(addr.divisionId),
      districtId: row.districtId ?? asIntOrNull(addr.districtId),
      upazilaId: row.upazilaId ?? asIntOrNull(addr.upazilaId),
      unionId: row.unionId ?? asIntOrNull(addr.unionId) ?? resolveUnionFromArea(areaId),
      areaId,
    });
    if (!normalized) continue;
    if (
      row.divisionId === normalized.divisionId &&
      row.districtId === normalized.districtId &&
      row.upazilaId === normalized.upazilaId &&
      row.unionId === normalized.unionId &&
      row.areaId === normalized.areaId
    ) {
      continue;
    }
    await prisma.branch.update({
      where: { id: row.id },
      data: {
        divisionId: normalized.divisionId,
        districtId: normalized.districtId,
        upazilaId: normalized.upazilaId,
        unionId: normalized.unionId,
        areaId: normalized.areaId,
      },
    });
    updated += 1;
  }
  return { scanned: rows.length, updated };
}

async function migrateDoctorProfiles(resolveUnionFromArea: (areaId: any) => number | null) {
  const rows = await prisma.doctorVerification.findMany({
    select: { id: true, divisionId: true, districtId: true, upazilaId: true, unionId: true, areaId: true, metadataJson: true },
  });
  let updated = 0;
  for (const row of rows) {
    const meta = row.metadataJson && typeof row.metadataJson === "object" ? row.metadataJson as any : {};
    const areaId = row.areaId ?? asIntOrNull(meta.bdAreaId) ?? asIntOrNull(meta.areaId);
    const normalized = await normalizeSelection({
      divisionId: row.divisionId ?? asIntOrNull(meta.divisionId),
      districtId: row.districtId ?? asIntOrNull(meta.districtId),
      upazilaId: row.upazilaId ?? asIntOrNull(meta.upazilaId),
      unionId: row.unionId ?? asIntOrNull(meta.unionId) ?? resolveUnionFromArea(areaId),
      areaId,
    });
    if (!normalized) continue;
    if (
      row.divisionId === normalized.divisionId &&
      row.districtId === normalized.districtId &&
      row.upazilaId === normalized.upazilaId &&
      row.unionId === normalized.unionId &&
      row.areaId === normalized.areaId
    ) {
      continue;
    }
    await prisma.doctorVerification.update({
      where: { id: row.id },
      data: {
        divisionId: normalized.divisionId,
        districtId: normalized.districtId,
        upazilaId: normalized.upazilaId,
        unionId: normalized.unionId,
        areaId: normalized.areaId,
      },
    });
    updated += 1;
  }
  return { scanned: rows.length, updated };
}

async function migrateProducers(resolveUnionFromArea: (areaId: any) => number | null) {
  const orgRows = await prisma.producerOrg.findMany({
    select: { id: true, divisionId: true, districtId: true, upazilaId: true, unionId: true, areaId: true, docsJson: true },
  });
  const factoryRows = await prisma.producerFactory.findMany({
    select: { id: true, divisionId: true, districtId: true, upazilaId: true, unionId: true, areaId: true, addressJson: true },
  });
  let updatedOrgs = 0;
  let updatedFactories = 0;

  for (const row of orgRows) {
    const json = row.docsJson && typeof row.docsJson === "object" ? row.docsJson as any : {};
    const areaId = row.areaId ?? asIntOrNull(json.bdAreaId) ?? asIntOrNull(json.areaId);
    const normalized = await normalizeSelection({
      divisionId: row.divisionId ?? asIntOrNull(json.divisionId),
      districtId: row.districtId ?? asIntOrNull(json.districtId),
      upazilaId: row.upazilaId ?? asIntOrNull(json.upazilaId),
      unionId: row.unionId ?? asIntOrNull(json.unionId) ?? resolveUnionFromArea(areaId),
      areaId,
    });
    if (!normalized) continue;
    if (
      row.divisionId === normalized.divisionId &&
      row.districtId === normalized.districtId &&
      row.upazilaId === normalized.upazilaId &&
      row.unionId === normalized.unionId &&
      row.areaId === normalized.areaId
    ) continue;
    await prisma.producerOrg.update({
      where: { id: row.id },
      data: normalized,
    });
    updatedOrgs += 1;
  }

  for (const row of factoryRows) {
    const json = row.addressJson && typeof row.addressJson === "object" ? row.addressJson as any : {};
    const areaId = row.areaId ?? asIntOrNull(json.bdAreaId) ?? asIntOrNull(json.areaId);
    const normalized = await normalizeSelection({
      divisionId: row.divisionId ?? asIntOrNull(json.divisionId),
      districtId: row.districtId ?? asIntOrNull(json.districtId),
      upazilaId: row.upazilaId ?? asIntOrNull(json.upazilaId),
      unionId: row.unionId ?? asIntOrNull(json.unionId) ?? resolveUnionFromArea(areaId),
      areaId,
    });
    if (!normalized) continue;
    if (
      row.divisionId === normalized.divisionId &&
      row.districtId === normalized.districtId &&
      row.upazilaId === normalized.upazilaId &&
      row.unionId === normalized.unionId &&
      row.areaId === normalized.areaId
    ) continue;
    await prisma.producerFactory.update({
      where: { id: row.id },
      data: normalized,
    });
    updatedFactories += 1;
  }

  return {
    orgs: { scanned: orgRows.length, updated: updatedOrgs },
    factories: { scanned: factoryRows.length, updated: updatedFactories },
  };
}

async function main() {
  const resolveUnionFromArea = await buildAreaToUnionResolver(prisma as any);

  const userProfiles = await migrateUserProfiles(resolveUnionFromArea);
  const ownerProfiles = await migrateOwnerProfiles(resolveUnionFromArea);
  const organizations = await migrateOrganizations(resolveUnionFromArea);
  const branches = await migrateBranches(resolveUnionFromArea);
  const doctors = await migrateDoctorProfiles(resolveUnionFromArea);
  const producers = await migrateProducers(resolveUnionFromArea);

  const report = {
    generatedAt: new Date().toISOString(),
    userProfiles,
    ownerProfiles,
    organizations,
    branches,
    doctors,
    producers,
  };

  const outDir = path.join(process.cwd(), "docs", "location-system-migration");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, "data-migration-report.json");
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2), "utf8");

  console.log("✅ Location reference migration complete.");
  console.log(report);
  console.log(`Report saved: ${outFile}`);
}

main()
  .catch((e) => {
    console.error("❌ migrate-location-references failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
