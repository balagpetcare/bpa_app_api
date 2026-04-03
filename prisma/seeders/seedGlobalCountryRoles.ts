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

function parseCsv(raw: string | undefined): string[] {
  return String(raw || "")
    .split(",")
    .map((x) => String(x || "").trim())
    .filter(Boolean);
}

function normalizeEmail(v: string | null | undefined): string {
  return String(v || "").trim().toLowerCase();
}

function normalizePhone(v: string | null | undefined): string {
  return String(v || "").replace(/\D/g, "");
}

function parseAdminUserIds(): number[] {
  return parseCsv(process.env.ADMIN_USER_IDS)
    .map((x) => Number(x))
    .filter(Boolean);
}

function parseAdminEmails(): string[] {
  const raw = process.env.ADMIN_EMAILS || process.env.SUPER_ADMIN_WHITELIST_EMAILS;
  return parseCsv(raw).map((x) => normalizeEmail(x)).filter(Boolean);
}

function parseAdminPhones(): string[] {
  const raw = process.env.ADMIN_PHONES || process.env.SUPER_ADMIN_WHITELIST_PHONES;
  return parseCsv(raw).map((x) => normalizePhone(x)).filter(Boolean);
}

async function resolveAdminUserIds(prisma: PrismaClient): Promise<number[]> {
  const ids = new Set<number>(parseAdminUserIds());
  const emails = parseAdminEmails();
  const phones = parseAdminPhones();

  const authOr: any[] = [
    ...emails.map((email) => ({ email: { equals: email, mode: "insensitive" as const } })),
    ...phones.map((phone) => ({ phone })),
    ...phones
      .map((phone) => (phone.length > 11 ? phone.slice(-11) : null))
      .filter(Boolean)
      .map((phone) => ({ phone })),
  ];

  if (authOr.length > 0) {
    const authMatches = await prisma.userAuth.findMany({
      where: { OR: authOr },
      select: { userId: true },
    });
    for (const row of authMatches) ids.add(Number(row.userId));
  }

  // Fallback: try first active whitelist entries (if env values were not configured).
  if (ids.size === 0) {
    const whitelist = await prisma.superAdminWhitelist.findMany({
      where: { isActive: true },
      select: { email: true, phone: true },
      orderBy: { id: "asc" },
      take: 10,
    });

    const wlEmails = whitelist.map((w) => normalizeEmail(w.email)).filter(Boolean);
    const wlPhones = whitelist.map((w) => normalizePhone(w.phone)).filter(Boolean);
    const wlOr: any[] = [
      ...wlEmails.map((email) => ({ email: { equals: email, mode: "insensitive" as const } })),
      ...wlPhones.map((phone) => ({ phone })),
      ...wlPhones
        .map((phone) => (phone.length > 11 ? phone.slice(-11) : null))
        .filter(Boolean)
        .map((phone) => ({ phone })),
    ];

    if (wlOr.length > 0) {
      const wlMatches = await prisma.userAuth.findMany({
        where: { OR: wlOr },
        select: { userId: true },
      });
      for (const row of wlMatches) ids.add(Number(row.userId));
    }
  }

  return Array.from(ids).filter((id) => Number.isFinite(id) && id > 0);
}

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
    { key: "admin.producers.read", label: "View producers", description: "List and view producer organizations and details." },
    { key: "admin.producers.write", label: "Manage producers", description: "Suspend, unsuspend, and update flags/quotas for producers." },
    { key: "admin.approvals.manage", label: "Manage approvals", description: "Review and approve or reject producer approvals." },
    { key: "admin.governance.products.review", label: "Review products", description: "Take/release reviewer lock on product approvals." },
    { key: "admin.governance.products.approve", label: "Approve products", description: "Approve or activate producer products." },
    { key: "admin.governance.products.request_changes", label: "Request product changes", description: "Request changes on submitted/under-review products." },
    { key: "admin.governance.products.archive", label: "Archive products", description: "Archive or unarchive rejected/inactive products." },
    { key: "admin.governance.batches.review", label: "Review batches", description: "Review batch submissions." },
    { key: "admin.governance.batches.approve", label: "Approve batches", description: "Approve or reject batches." },
    { key: "admin.governance.batches.allocate_codes", label: "Allocate codes", description: "Allow code allocation for batches." },
    { key: "admin.governance.batches.void", label: "Void batches", description: "Void batches (no verified codes)." },
    { key: "admin.governance.enforcement.hide", label: "Hide products", description: "Hide/unhide products (enforcement)." },
    { key: "admin.governance.enforcement.freeze", label: "Freeze batches", description: "Freeze batch printing/export." },
    { key: "admin.governance.enforcement.suspend", label: "Suspend producers", description: "Suspend producer org with incident." },
    { key: "admin.governance.enforcement.cases", label: "Trust & Safety cases", description: "Manage complaint cases, evidence, and trace." },
    { key: "admin.governance.enforcement.actions", label: "Enforcement actions", description: "Apply or revert enforcement actions." },
    { key: "admin.governance.incidents.manage", label: "Manage incidents", description: "Create and resolve governance incidents." },
    { key: "admin.governance.analytics.read", label: "Governance analytics", description: "View governance analytics." },
    { key: "admin.governance.code.search", label: "Code lookup", description: "Search codes and trace producer/product/batch." },
    { key: "admin.audit.read", label: "View governance audit", description: "Read governance audit and metrics." },
    { key: "admin.permissions.read", label: "View permissions registry", description: "Read grouped permissions registry." },
    { key: "admin.kyc.manage", label: "Manage producer KYC", description: "Review and decide producer KYC verification." },
    { key: "admin.support.tickets.manage", label: "Manage support tickets", description: "List, view, update, assign, internal notes." },
    { key: "admin.support.tickets.respond", label: "Respond to tickets", description: "Post public replies to producer tickets." },
    { key: "admin.support.tickets.assign", label: "Assign tickets", description: "Assign tickets to support agents." },
    { key: "admin.support.tickets.escalate", label: "Escalate to enforcement", description: "Escalate ticket to Trust & Safety case." },
    { key: "medicine.master.read", label: "View medicine master data", description: "Admin medicine workspace read." },
    { key: "medicine.master.write", label: "Manage medicine master data", description: "Admin medicine workspace write." },
    { key: "medicine.catalog.listing.manage", label: "Manage country medicine listings", description: "Country catalog listing CRUD." },
    { key: "medicine.catalog.import", label: "Medicine catalog import", description: "CSV import pipeline." },
    { key: "medicine.catalog.export", label: "Export medicine catalog", description: "Listings CSV export." },
    { key: "medicine.catalog.review", label: "Medicine import review", description: "Review and conflict queues." },
    { key: "medicine.catalog.governance", label: "Medicine catalog governance", description: "Elevated catalog governance." },
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
      key: "PLATFORM_ADMIN",
      label: "Platform Admin",
      scope: "GLOBAL",
      permissionKeys: [
        "admin.producers.read",
        "admin.producers.write",
        "admin.approvals.manage",
        "admin.governance.products.review",
        "admin.governance.products.approve",
        "admin.governance.products.request_changes",
        "admin.governance.products.archive",
        "admin.governance.batches.review",
        "admin.governance.batches.approve",
        "admin.governance.batches.allocate_codes",
        "admin.governance.batches.void",
        "admin.governance.enforcement.hide",
        "admin.governance.enforcement.freeze",
        "admin.governance.enforcement.suspend",
        "admin.governance.enforcement.cases",
        "admin.governance.enforcement.actions",
        "admin.governance.incidents.manage",
        "admin.governance.analytics.read",
        "admin.governance.code.search",
        "admin.audit.read",
        "admin.permissions.read",
        "admin.kyc.manage",
        "admin.support.tickets.manage",
        "admin.support.tickets.respond",
        "admin.support.tickets.assign",
        "admin.support.tickets.escalate",
        "medicine.master.read",
        "medicine.master.write",
        "medicine.catalog.listing.manage",
        "medicine.catalog.import",
        "medicine.catalog.export",
        "medicine.catalog.review",
        "medicine.catalog.governance",
      ],
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
        "admin.support.tickets.manage",
        "admin.support.tickets.respond",
        "admin.support.tickets.assign",
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

  // Auto-assign PLATFORM_ADMIN to env/whitelist admin users.
  const platformAdminRoleId = roleMap.get("PLATFORM_ADMIN");
  if (platformAdminRoleId) {
    const adminUserIds = await resolveAdminUserIds(prisma);
    for (const userId of adminUserIds) {
      await prisma.userGlobalRole.upsert({
        where: { userId_roleId: { userId, roleId: platformAdminRoleId } },
        update: {},
        create: { userId, roleId: platformAdminRoleId },
      });
    }
    if (adminUserIds.length) {
      console.log(`[seedGlobalCountryRoles] PLATFORM_ADMIN assigned to ${adminUserIds.length} user(s).`);
    }
  }
}
