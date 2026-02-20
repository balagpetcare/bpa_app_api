/**
 * BPA Permission → Menu registry (server-side)
 * - No DB change in this patch (static mapping)
 * - UI consumes /api/v1/me/menu?app=owner|shop|clinic|admin|partner
 */

const ROLE_PERMISSIONS = {
  OWNER: [
    "owner.dashboard.read",
    "org.read",
    "org.write",
    "branch.read",
    "branch.write",
    "staff.read",
    "staff.write",
    "wallet.read",
    "reports.read",
    "settings.read",
    "settings.write",
    "products.read",
    "products.write",
    "inventory.read",
    "inventory.write",
    "orders.read",
    "orders.write",
    "pricing.read",
    "pricing.write",
    "vendors.read",
    "transfers.read",
    "transfers.write",
    "returns.read",
    "returns.write",
    "online-store.read",
    "online-store.write",
  ],
  ORG_ADMIN: [
    "owner.dashboard.read",
    "org.read",
    "org.write",
    "branch.read",
    "branch.write",
    "staff.read",
    "staff.write",
    "wallet.read",
    "reports.read",
    "settings.read",
    "settings.write",
  ],
  BRANCH_MANAGER: [
    "branch.dashboard.read",
    "orders.read",
    "orders.write",
    "inventory.read",
    "inventory.adjust",
    "customers.read",
    "customers.write",
    "staff.read",
    "staff.write",
    "reports.read",
  ],
  BRANCH_STAFF: [
    "branch.dashboard.read",
    "orders.read",
    "orders.write",
    "inventory.read",
    "customers.read",
  ],
  SELLER: [
    "branch.dashboard.read",
    "orders.read",
    "orders.write",
    "inventory.read",
  ],
  DELIVERY_MANAGER: [
    "delivery.read",
    "delivery.write",
    "orders.read",
  ],
  DELIVERY_STAFF: [
    "delivery.read",
    "orders.read",
  ],
};

function uniq(arr) {
  return Array.from(new Set((arr || []).filter(Boolean)));
}

function permissionsForMembers(orgMembers, branchMemberships) {
  const perms = [];
  for (const m of orgMembers || []) {
    const role = String(m?.role || "").toUpperCase();
    perms.push(...(ROLE_PERMISSIONS[role] || []));
  }
  for (const m of branchMemberships || []) {
    const role = String(m?.role || "").toUpperCase();
    perms.push(...(ROLE_PERMISSIONS[role] || []));
  }
  return uniq(perms);
}

/**
 * Menu registry (WowDash sidebar-friendly structure)
 * NOTE: keep hrefs aligned with Next app routes.
 */
const MENU_REGISTRY = {
  owner: {
    home: { href: "/owner/dashboard", label: "Dashboard" },
    groups: [
      {
        title: "My Business",
        icon: "solar:buildings-2-outline",
        items: [
          { href: "/owner/organizations", label: "Organizations", requires: ["org.read"] },
          { href: "/owner/branches", label: "Branches", requires: ["branch.read"] },
          { href: "/owner/staffs", label: "Staff", requires: ["staff.read"] },
          { href: "/owner/onboarding", label: "Onboarding", requires: ["org.read"] },
        ],
      },
      {
        title: "Products & Inventory",
        icon: "solar:box-outline",
        items: [
          { href: "/owner/products", label: "Products", requires: ["products.read"] },
          { href: "/owner/inventory", label: "Inventory", requires: ["inventory.read"] },
          { href: "/owner/transfers", label: "Stock Transfers", requires: ["transfers.read"] },
          { href: "/owner/product-approvals", label: "Product Approvals", requires: ["products.read"] },
        ],
      },
      {
        title: "Sales & Orders",
        icon: "solar:cart-large-2-outline",
        items: [
          { href: "/owner/orders", label: "Orders", requires: ["orders.read"] },
          { href: "/owner/returns", label: "Returns", requires: ["returns.read"] },
        ],
      },
      {
        title: "Financial",
        icon: "solar:wallet-outline",
        items: [
          { href: "/owner/wallet", label: "Wallet", requires: ["wallet.read"] },
          { href: "/owner/reports/revenue", label: "Revenue Reports", requires: ["reports.read"] },
          { href: "/owner/reports/sales", label: "Sales Reports", requires: ["reports.read"] },
        ],
      },
      {
        title: "Analytics & Reports",
        icon: "solar:chart-outline",
        items: [
          { href: "/owner/reports", label: "All Reports", requires: ["reports.read"] },
          { href: "/owner/reports/sales", label: "Sales Analytics", requires: ["reports.read"] },
          { href: "/owner/reports/stock", label: "Stock Reports", requires: ["reports.read"] },
        ],
      },
      {
        title: "Operations",
        icon: "solar:settings-outline",
        items: [
          { href: "/owner/vendors", label: "Vendors", requires: ["vendors.read"] },
          { href: "/owner/transfers", label: "Transfers", requires: ["transfers.read"] },
        ],
      },
      {
        title: "Settings",
        icon: "solar:settings-outline",
        items: [
          { href: "/owner/profile", label: "Profile", requires: ["settings.read"] },
          { href: "/owner/settings", label: "Settings", requires: ["settings.read"] },
          { href: "/owner/verification", label: "Verification (KYC)", requires: ["settings.read"] },
        ],
      },
    ],
  },

  shop: {
    home: { href: "/shop", label: "Dashboard" },
    groups: [
      {
        title: "Sales",
        icon: "solar:cart-large-2-outline",
        items: [
          { href: "/shop/orders", label: "Orders", requires: ["orders.read"] },
          { href: "/shop/inventory", label: "Inventory", requires: ["inventory.read"] },
          { href: "/shop/customers", label: "Customers", requires: ["customers.read"] },
          { href: "/shop/staff", label: "Staff", requires: ["staff.read"] },
        ],
      },
    ],
  },

  clinic: {
    home: { href: "/clinic", label: "Dashboard" },
    groups: [
      {
        title: "Clinic",
        icon: "solar:stethoscope-outline",
        items: [
          { href: "/clinic/appointments", label: "Appointments", requires: ["clinic.appointments.read"] },
          { href: "/clinic/patients", label: "Patients", requires: ["clinic.patients.read"] },
          { href: "/clinic/staff", label: "Staff", requires: ["staff.read"] },
        ],
      },
    ],
  },

  admin: {
    home: { href: "/admin/dashboard", label: "Dashboard" },
    groups: [
      {
        title: "System",
        icon: "solar:settings-outline",
        items: [
          { href: "/admin/users", label: "Users", requires: ["admin.users.read"] },
          { href: "/admin/staff", label: "Staff", requires: ["admin.staff.read"] },
          { href: "/admin/roles", label: "Roles", requires: ["admin.roles.read"] },
          { href: "/admin/permissions", label: "Permissions", requires: ["admin.permissions.read"] },
        ],
      },
    ],
  },
};

function filterMenuByPermissions(appKey, permissions) {
  const app = MENU_REGISTRY[String(appKey || "owner").toLowerCase()] || MENU_REGISTRY.owner;

  const can = (reqs) => {
    if (!reqs || reqs.length === 0) return true;
    const set = new Set(permissions || []);
    return reqs.some((k) => set.has(k));
  };

  const groups = (app.groups || [])
    .map((g) => {
      const items = (g.items || []).filter((it) => can(it.requires));
      if (!items.length) return null;
      return { ...g, items };
    })
    .filter(Boolean);

  // If home itself is permissioned later, keep it as is for now.
  return { home: app.home, groups };
}

module.exports = {
  ROLE_PERMISSIONS,
  permissionsForMembers,
  filterMenuByPermissions,
};

export {};
