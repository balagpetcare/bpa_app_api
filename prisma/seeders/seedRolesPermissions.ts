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
    { key: "clinic.appointments.collect_payment", label: "Collect appointment payment" },
    { key: "clinic.appointments.apply_discount", label: "Apply discount" },
    { key: "clinic.appointments.reprint", label: "Reprint slips" },
    { key: "clinic.appointments.assign_doctor", label: "Assign doctor to appointment" },
    { key: "clinic.queue.read", label: "Read queue" },
    { key: "clinic.queue.manage", label: "Manage queue" },
    { key: "clinic.queue.screen", label: "View queue screen" },
    { key: "clinic.patients.read", label: "Read patients" },
    { key: "clinic.patients.manage", label: "Manage patients" },
    { key: "clinic.visits.read", label: "Read visits" },
    { key: "clinic.visits.manage", label: "Manage visits" },
    { key: "clinic.emr.read", label: "View EMR" },
    { key: "clinic.emr.write", label: "Write EMR" },
    { key: "clinic.prescription.read", label: "View prescriptions" },
    { key: "clinic.prescription.write", label: "Write prescriptions" },
    { key: "clinic.settings.read", label: "View clinic settings" },
    { key: "clinic.settings.write", label: "Edit clinic settings" },
    { key: "clinic.services.manage", label: "Manage clinic services" },
    { key: "clinic.overview.read", label: "View clinic overview" },
    { key: "clinic.rooms.manage", label: "Manage clinic rooms" },
    { key: "clinic.staff.manage", label: "Manage clinic staff profiles" },
    { key: "clinic.schedule.manage", label: "Manage clinic schedule templates" },
    { key: "clinic.holidays.manage", label: "Manage clinic holidays" },
    { key: "clinic.emergency.manage", label: "Manage emergency slot policy" },
    { key: "clinic.fees.manage", label: "Manage clinic fees" },

    // Clinic Supply Chain (enterprise)
    { key: "clinic.supply.request.create", label: "Create supply request" },
    { key: "clinic.supply.request.submit", label: "Submit supply request" },
    { key: "clinic.supply.request.review", label: "Review supply request" },
    { key: "clinic.supply.transfer.dispatch", label: "Dispatch transfer" },
    { key: "clinic.supply.transfer.receive", label: "Receive transfer" },
    { key: "clinic.sterilization.manage", label: "Manage sterilization" },
    { key: "clinic.instrument.manage", label: "Manage instruments" },
    { key: "clinic.audit.create", label: "Create stock audit" },
    { key: "clinic.audit.approve", label: "Approve stock audit" },
    { key: "clinic.wastage.report", label: "Report wastage" },
    { key: "clinic.wastage.approve", label: "Approve wastage" },
    { key: "clinic.refill.view", label: "View refill suggestions" },
    { key: "clinic.refill.convert", label: "Convert to supply request" },

    // Medicine Control (CCMLPA)
    { key: "medicine.policy.read", label: "View medicine policies" },
    { key: "medicine.policy.manage", label: "Manage medicine policies" },
    { key: "medicine.dispense.request", label: "Request medicine dispense" },
    { key: "medicine.dispense.approve", label: "Approve dispense requests" },
    { key: "medicine.dispense.issue", label: "Issue medicine" },
    { key: "medicine.vial.open", label: "Open vial" },
    { key: "medicine.vial.use", label: "Log vial dose use" },
    { key: "medicine.vial.return", label: "Return vial" },
    { key: "medicine.dose.record", label: "Record dose" },
    { key: "medicine.dose.read", label: "View dose records" },
    { key: "medicine.return.submit", label: "Submit vial return" },
    { key: "medicine.return.verify", label: "Verify vial return" },
    { key: "medicine.audit.bin.view", label: "View audit bins" },
    { key: "medicine.audit.bin.manage", label: "Manage audit bins" },
    { key: "medicine.destruction.approve", label: "Approve destruction" },

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

    // Manager Operations (Branch Manager Control)
    { key: "manager.appointments.create", label: "Create appointments" },
    { key: "manager.appointments.assign_doctor", label: "Assign doctor" },
    { key: "manager.appointments.cancel", label: "Cancel appointments" },
    { key: "manager.appointments.reschedule", label: "Reschedule appointments" },
    { key: "manager.walkin.register", label: "Register walk-in" },
    { key: "manager.patients.create", label: "Create patients" },
    { key: "manager.patients.edit", label: "Edit patients" },
    { key: "manager.patients.view_history", label: "View patient history" },
    { key: "manager.inventory.update_stock", label: "Update stock" },
    { key: "manager.inventory.supply_request", label: "Supply request" },
    { key: "manager.inventory.purchase_request", label: "Purchase request" },
    { key: "manager.inventory.low_stock_alert", label: "Low stock alert" },
    { key: "manager.services.enable_disable", label: "Enable/disable services" },
    { key: "manager.packages.activate", label: "Activate packages" },
    { key: "manager.discount.apply", label: "Apply discount" },
    { key: "manager.pricing.view", label: "View pricing" },
    { key: "manager.staff.assign", label: "Assign staff" },
    { key: "manager.staff.duty_roster", label: "Duty roster" },
    { key: "manager.staff.leave_approve", label: "Approve leave" },
    { key: "manager.staff.performance_view", label: "View staff performance" },
    { key: "manager.billing.create_invoice", label: "Create invoice" },
    { key: "manager.billing.collect_payment", label: "Collect payment" },
    { key: "manager.billing.refund_request", label: "Refund request" },
    { key: "manager.reports.daily_revenue", label: "Daily revenue report" },
    { key: "manager.reports.doctor_performance", label: "Doctor performance report" },
    { key: "manager.reports.inventory_usage", label: "Inventory usage report" },
    { key: "manager.reports.export", label: "Export reports" },
    { key: "manager.branch.settings", label: "Branch settings" },
    { key: "manager.branch.hours", label: "Branch hours" },
    { key: "manager.branch.announcements", label: "Branch announcements" },
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
        "clinic.settings.read","clinic.settings.write",
        "clinic.services.manage","clinic.overview.read",
        "clinic.rooms.manage",
        "clinic.staff.manage",
        "clinic.schedule.manage",
        "clinic.holidays.manage",
        "clinic.emergency.manage",
        "clinic.fees.manage",
        "manager.appointments.create","manager.appointments.assign_doctor","manager.appointments.cancel","manager.appointments.reschedule","manager.walkin.register",
        "manager.patients.create","manager.patients.edit","manager.patients.view_history",
        "manager.inventory.update_stock","manager.inventory.supply_request","manager.inventory.purchase_request","manager.inventory.low_stock_alert",
        "manager.services.enable_disable","manager.packages.activate","manager.discount.apply","manager.pricing.view",
        "manager.staff.assign","manager.staff.duty_roster","manager.staff.leave_approve","manager.staff.performance_view",
        "manager.billing.create_invoice","manager.billing.collect_payment","manager.billing.refund_request",
        "manager.reports.daily_revenue","manager.reports.doctor_performance","manager.reports.inventory_usage","manager.reports.export",
        "manager.branch.settings","manager.branch.hours","manager.branch.announcements",
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
      permissionKeys: [
        "clinic.appointments.read","clinic.appointments.manage","clinic.patients.read","clinic.patients.manage",
        "clinic.visits.read","clinic.visits.manage",
        "clinic.settings.read","clinic.overview.read","clinic.services.manage",
        "clinic.queue.manage","clinic.queue.screen",
        "clinic.emr.read","clinic.emr.write",
        "clinic.prescription.read","clinic.prescription.write",
      ],
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
