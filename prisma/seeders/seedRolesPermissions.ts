import { PrismaClient } from "@prisma/client";

type SeedPermission = { key: string; label: string; description?: string };
type SeedRole = { key: string; label: string; scope: "ORG" | "BRANCH"; permissionKeys: string[] };

/**
 * Seeds system Roles + Permissions + RolePermission matrix.
 * Safe to run multiple times (upsert-based).
 */
export default async function seedRolesPermissions(prisma: PrismaClient) {
  const permissions: SeedPermission[] = [
    { key: "org.read", label: "Read organization" },
    { key: "org.write", label: "Manage organization" },
    { key: "branches.read", label: "Read branches" },
    { key: "branches.write", label: "Manage branches" },

    { key: "staff.read", label: "Read staff" },
    { key: "staff.write", label: "Manage staff" },

    { key: "orders.read", label: "Read orders" },
    { key: "orders.write", label: "Manage orders" },

    { key: "inventory.read", label: "Read inventory" },
    { key: "inventory.write", label: "Manage inventory" },

    { key: "customers.read", label: "Read customers" },
    { key: "customers.write", label: "Manage customers" },

    { key: "reports.read", label: "Read reports" },

    { key: "settings.read", label: "Read settings" },
    { key: "settings.write", label: "Manage settings" },

    { key: "delivery.read", label: "Read delivery" },
    { key: "delivery.write", label: "Manage delivery" },

    { key: "clinic.appointments.read", label: "Read appointments" },
    { key: "clinic.appointments.manage", label: "Manage appointments" },
    { key: "clinic.patients.read", label: "Read patients" },
    { key: "clinic.patients.manage", label: "Manage patients" },

    // Producer Authentication System
    { key: "producer.org.read", label: "Read producer organization", description: "View producer organization details" },
    { key: "producer.org.write", label: "Manage producer organization", description: "Edit producer organization settings" },
    { key: "producer.kyc.submit", label: "Submit KYC", description: "Submit KYC documents for verification" },
    { key: "producer.kyc.view", label: "View KYC status", description: "Check KYC verification status" },
    { key: "producer.products.read", label: "Read products", description: "View product list and details" },
    { key: "producer.products.write", label: "Manage products", description: "Create and edit products" },
    { key: "producer.batches.read", label: "Read batches", description: "View batch list and details" },
    { key: "producer.batches.write", label: "Manage batches", description: "Create and manage production batches" },
    { key: "producer.batches.print", label: "Print batch / Mark batch as printed", description: "Record batch print events and view print count" },
    { key: "producer.codes.generate", label: "Generate QR codes", description: "Generate authenticity QR codes" },
    { key: "producer.codes.export", label: "Export codes", description: "Export generated codes" },
    { key: "producer.codes.revoke", label: "Revoke allocations", description: "Revoke issued serial allocations (owner only)" },
    { key: "producer.verification.read", label: "Read verification logs", description: "View verification history and analytics" },
    { key: "producer.analytics.read", label: "Read analytics", description: "View producer analytics and reports" },
    { key: "producer.tickets.read", label: "View support tickets", description: "View own org support tickets and messages." },
    { key: "producer.tickets.write", label: "Create and reply to tickets", description: "Create tickets, reply, close, reopen." },
  ];

  const roles: SeedRole[] = [
    {
      key: "OWNER",
      label: "Owner",
      scope: "ORG",
      permissionKeys: permissions.map((p) => p.key),
    },
    {
      key: "ORG_ADMIN",
      label: "Org Admin",
      scope: "ORG",
      permissionKeys: [
        "org.read","org.write",
        "branches.read","branches.write",
        "staff.read","staff.write",
        "orders.read","orders.write",
        "inventory.read","inventory.write",
        "customers.read","customers.write",
        "reports.read",
        "settings.read","settings.write",
      ],
    },
    {
      key: "BRANCH_MANAGER",
      label: "Branch Manager",
      scope: "BRANCH",
      permissionKeys: [
        "branches.read",
        "staff.read","staff.write",
        "orders.read","orders.write",
        "inventory.read","inventory.write",
        "customers.read","customers.write",
        "reports.read",
      ],
    },
    {
      key: "SELLER",
      label: "Seller",
      scope: "BRANCH",
      permissionKeys: ["orders.read","orders.write","customers.read","inventory.read"],
    },
    {
      key: "BRANCH_STAFF",
      label: "Branch Staff",
      scope: "BRANCH",
      permissionKeys: ["orders.read","orders.write","inventory.read","customers.read","branches.read"],
    },
    {
      key: "DELIVERY_MANAGER",
      label: "Delivery Manager",
      scope: "BRANCH",
      permissionKeys: ["orders.read","delivery.read","delivery.write"],
    },
    {
      key: "DELIVERY_STAFF",
      label: "Delivery Staff",
      scope: "BRANCH",
      permissionKeys: ["orders.read","delivery.read"],
    },
    {
      key: "CLINIC_STAFF",
      label: "Clinic Staff",
      scope: "BRANCH",
      permissionKeys: ["clinic.appointments.read","clinic.patients.read"],
    },
    // Producer Authentication System Roles
    {
      key: "PRODUCER_OWNER",
      label: "Producer Owner",
      scope: "ORG",
      permissionKeys: [
        "producer.org.read", "producer.org.write",
        "producer.kyc.submit", "producer.kyc.view",
        "producer.products.read", "producer.products.write",
        "producer.batches.read", "producer.batches.write", "producer.batches.print",
        "producer.codes.generate", "producer.codes.export",
        "producer.verification.read", "producer.analytics.read",
        "producer.tickets.read", "producer.tickets.write",
      ],
    },
    {
      key: "PRODUCER_MANAGER",
      label: "Producer Manager",
      scope: "ORG",
      permissionKeys: [
        "producer.org.read",
        "producer.kyc.view",
        "producer.products.read", "producer.products.write",
        "producer.batches.read", "producer.batches.write", "producer.batches.print",
        "producer.codes.generate", "producer.codes.export",
        "producer.verification.read", "producer.analytics.read",
        "producer.tickets.read", "producer.tickets.write",
      ],
    },
    {
      key: "PRODUCER_STAFF",
      label: "Producer Staff",
      scope: "ORG",
      permissionKeys: [
        "producer.products.read", "producer.products.write",
        "producer.batches.read", "producer.batches.print",
        "producer.codes.generate", "producer.codes.export",
        "producer.tickets.read", "producer.tickets.write",
      ],
    },
    {
      key: "PRODUCER_AUDITOR",
      label: "Producer Auditor",
      scope: "ORG",
      permissionKeys: [
        "producer.org.read",
        "producer.products.read",
        "producer.batches.read",
        "producer.verification.read",
        "producer.analytics.read",
        "producer.tickets.read",
      ],
    },
    {
      key: "PRODUCER_VIEWER",
      label: "Producer Viewer",
      scope: "ORG",
      permissionKeys: [
        "producer.org.read",
        "producer.products.read",
        "producer.batches.read",
        "producer.tickets.read",
      ],
    },
  ];

  // Upsert permissions
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

  // Upsert roles
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

  // Upsert role_permissions matrix
  for (const r of roles) {
    const roleId = roleMap.get(r.key)!;

    // ensure exact set (idempotent): create missing links; do not delete extras (safe)
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

  // One-time verification: PRODUCER_STAFF has producer.products.write (for staff product create)
  const producerStaffRole = await prisma.role.findUnique({
    where: { key: "PRODUCER_STAFF" },
    include: { rolePermissions: { include: { permission: { select: { key: true } } } } },
  });
  const staffPermKeys = (producerStaffRole?.rolePermissions ?? []).map((rp) => rp.permission.key);
  const hasProductsWrite = staffPermKeys.includes("producer.products.write");
  console.log("[seedRolesPermissions] PRODUCER_STAFF has producer.products.write:", hasProductsWrite);
}
