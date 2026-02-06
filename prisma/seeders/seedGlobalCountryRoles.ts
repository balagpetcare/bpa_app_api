/**
 * Phase 4: Seed Global + Country roles and permissions.
 * Global: SUPER_ADMIN, COMPLIANCE_ADMIN, PLATFORM_FINANCE
 * Country: COUNTRY_ADMIN, COUNTRY_COMPLIANCE, COUNTRY_SUPPORT, COUNTRY_CONTENT_MOD
 * Reference: docs/GLOBAL_COUNTRY_WISE_DESIGN_BLUEPRINT.md
 */

import { PrismaClient } from "@prisma/client";

type SeedPermission = { key: string; label: string; description?: string };
type SeedRole = {
  key: string;
  label: string;
  scope: "GLOBAL" | "COUNTRY" | "STATE";
  permissionKeys: string[];
};

export default async function seedGlobalCountryRoles(prisma: PrismaClient) {
  const permissions: SeedPermission[] = [
    { key: "global.admin", label: "Global admin", description: "Full platform access" },
    { key: "global.compliance.review", label: "Compliance review", description: "Review compliance cases" },
    { key: "global.finance", label: "Platform finance", description: "Platform-level finance operations" },
    { key: "country.admin", label: "Country admin", description: "Country-level admin" },
    { key: "country.compliance", label: "Country compliance", description: "Country compliance review" },
    { key: "country.support", label: "Country support", description: "Country support operations" },
    { key: "country.content.moderate", label: "Content moderation", description: "Moderate content in country" },
    { key: "country.dashboard.read", label: "Country dashboard read" },
    { key: "country.operations.read", label: "Country operations read" },
    { key: "country.adoptions.read", label: "Country adoptions read" },
    { key: "country.donations.read", label: "Country donations read" },
    { key: "country.fundraising.read", label: "Country fundraising read" },
    { key: "country.clinics.read", label: "Country clinics read" },
    { key: "country.petshops.read", label: "Country petshops read" },
    { key: "country.foster.read", label: "Country foster care read" },
    { key: "country.rescue.read", label: "Country rescue read" },
    { key: "country.shelters.read", label: "Country shelters read" },
    { key: "country.moderation.read", label: "Country moderation read" },
    { key: "country.moderation.write", label: "Country moderation write" },
    { key: "country.support.read", label: "Country support read" },
    { key: "country.support.write", label: "Country support write" },
    { key: "country.orgs.read", label: "Country organizations read" },
    { key: "country.orgs.verify", label: "Country organizations verify" },
    { key: "country.staff.read", label: "Country staff read" },
    { key: "country.staff.invite", label: "Country staff invite" },
    { key: "country.staff.manage", label: "Country staff manage" },
    { key: "country.compliance.read", label: "Country compliance read" },
    { key: "country.compliance.write", label: "Country compliance write" },
    { key: "country.reports.read", label: "Country reports read" },
    { key: "country.audit.read", label: "Country audit read" },
    { key: "country.settings.features.read", label: "Country feature toggles read" },
    { key: "country.settings.features.write", label: "Country feature toggles write" },
    { key: "country.settings.policies.read", label: "Country policies read" },
    { key: "country.settings.policies.write", label: "Country policies write" },
    { key: "country.profile.read", label: "Country profile read" },
    { key: "state.admin", label: "State admin", description: "State-level admin" },
    { key: "state.support", label: "State support", description: "State support operations" },
  ];

  const COUNTRY_BASE = [
    "country.dashboard.read",
    "country.operations.read",
    "country.orgs.read",
    "country.reports.read",
    "country.audit.read",
    "country.profile.read",
  ];

  const COUNTRY_OPERATIONS_ALL = [
    "country.adoptions.read",
    "country.donations.read",
    "country.fundraising.read",
    "country.clinics.read",
    "country.petshops.read",
    "country.foster.read",
    "country.rescue.read",
    "country.shelters.read",
  ];

  const roles: SeedRole[] = [
    {
      key: "SUPER_ADMIN",
      label: "Super Admin",
      scope: "GLOBAL",
      permissionKeys: ["global.admin"],
    },
    {
      key: "COMPLIANCE_ADMIN",
      label: "Compliance Admin",
      scope: "GLOBAL",
      permissionKeys: ["global.compliance.review"],
    },
    {
      key: "PLATFORM_FINANCE",
      label: "Platform Finance",
      scope: "GLOBAL",
      permissionKeys: ["global.finance"],
    },
    {
      key: "COUNTRY_ADMIN",
      label: "Country Admin",
      scope: "COUNTRY",
      permissionKeys: [
        "country.admin",
        ...COUNTRY_BASE,
        ...COUNTRY_OPERATIONS_ALL,
        "country.moderation.read",
        "country.moderation.write",
        "country.support.read",
        "country.support.write",
        "country.orgs.verify",
        "country.staff.read",
        "country.staff.invite",
        "country.staff.manage",
        "country.compliance.read",
        "country.compliance.write",
        "country.settings.features.read",
        "country.settings.features.write",
        "country.settings.policies.read",
        "country.settings.policies.write",
      ],
    },
    {
      key: "COUNTRY_COMPLIANCE",
      label: "Country Compliance",
      scope: "COUNTRY",
      permissionKeys: [
        "country.compliance",
        ...COUNTRY_BASE,
        "country.donations.read",
        "country.fundraising.read",
        "country.moderation.read",
        "country.support.read",
        "country.orgs.verify",
        "country.compliance.read",
        "country.compliance.write",
        "country.settings.features.read",
        "country.settings.policies.read",
        "country.settings.policies.write",
      ],
    },
    {
      key: "COUNTRY_SUPPORT",
      label: "Country Support",
      scope: "COUNTRY",
      permissionKeys: [
        "country.support",
        ...COUNTRY_BASE,
        ...COUNTRY_OPERATIONS_ALL,
        "country.moderation.read",
        "country.support.read",
        "country.support.write",
      ],
    },
    {
      key: "COUNTRY_CONTENT_MOD",
      label: "Country Content Moderator",
      scope: "COUNTRY",
      permissionKeys: [
        "country.content.moderate",
        ...COUNTRY_BASE,
        "country.adoptions.read",
        "country.moderation.read",
        "country.moderation.write",
        "country.support.read",
      ],
    },
    {
      key: "STATE_ADMIN",
      label: "State Admin",
      scope: "STATE",
      permissionKeys: ["state.admin"],
    },
    {
      key: "STATE_SUPPORT",
      label: "State Support",
      scope: "STATE",
      permissionKeys: ["state.support"],
    },
  ];

  const permMap = new Map<string, number>();
  for (const p of permissions) {
    const row = await prisma.permission.upsert({
      where: { key: p.key },
      update: { label: p.label, description: p.description || null },
      create: { key: p.key, label: p.label, description: p.description || null },
      select: { id: true, key: true },
    });
    permMap.set(row.key, row.id);
  }

  const roleMap = new Map<string, number>();
  for (const r of roles) {
    const row = await prisma.role.upsert({
      where: { key: r.key },
      update: { label: r.label, scope: r.scope, isSystem: true },
      create: { key: r.key, label: r.label, scope: r.scope, isSystem: true },
      select: { id: true, key: true },
    });
    roleMap.set(row.key, row.id);
  }

  for (const r of roles) {
    const roleId = roleMap.get(r.key)!;
    for (const pk of r.permissionKeys) {
      const permissionId = permMap.get(pk);
      if (!permissionId) continue;
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId, permissionId } },
        update: {},
        create: { roleId, permissionId },
      });
    }
  }
}
