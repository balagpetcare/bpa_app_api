# BRANCH_SIDEBAR_CONFIG.md
> Goal: Dynamic sidebar for `/staff/branch/[branchId]` that changes by permissions and branch type.  
> Style: WowDash sidebar (icons + collapsible groups).

---

## 1) Sidebar Rules
1. **Branch Context Required**: all sidebar links include `/staff/branch/{branchId}`
2. **Permission Driven**:
   - hide item if user lacks `requiredPerm`
   - hide group if all children are hidden
3. **Branch Type Driven**:
   - show “Services” only if `branch.type === "CLINIC"`
   - show “POS” if shop/clinic supports POS in settings

---

## 2) Config (JSON-like)
> Implement as a `const BRANCH_SIDEBAR = [...]` in your app (TS file).

```ts
export const BRANCH_SIDEBAR = [
  {
    group: "Overview",
    items: [
      { key: "overview", label: "Overview", icon: "RiDashboardLine", href: (id)=>`/staff/branch/${id}`, requiredPerm: "dashboard.view" },
      { key: "tasks", label: "Tasks", icon: "RiTaskLine", href: (id)=>`/staff/branch/${id}/tasks`, requiredPerm: "tasks.view" },
      { key: "approvals", label: "Approvals", icon: "RiCheckboxMultipleLine", href: (id)=>`/staff/branch/${id}/approvals`, requiredPerm: "approvals.view" },
    ],
  },
  {
    group: "Operations",
    items: [
      { key: "inventory", label: "Inventory", icon: "RiArchiveLine", href: (id)=>`/staff/branch/${id}/inventory`, requiredPerm: "inventory.read" },
      { key: "receive", label: "Receive Stock", icon: "RiDownloadCloud2Line", href: (id)=>`/staff/branch/${id}/inventory/receive`, requiredPerm: "inventory.receive" },
      { key: "adjustments", label: "Adjustments", icon: "RiScales3Line", href: (id)=>`/staff/branch/${id}/inventory/adjustments`, requiredPerm: "inventory.adjust" },
      { key: "transfers", label: "Transfers", icon: "RiSwapLine", href: (id)=>`/staff/branch/${id}/inventory/transfers`, requiredPerm: "inventory.transfer" },
      { key: "pos", label: "POS / Sales", icon: "RiShoppingCart2Line", href: (id)=>`/staff/branch/${id}/pos`, requiredPerm: "pos.view" },
      { key: "customers", label: "Customers", icon: "RiUser3Line", href: (id)=>`/staff/branch/${id}/customers`, requiredPerm: "customers.view" },
    ],
  },
  {
    group: "Clinic",
    featureFlag: (branch)=>branch.type === "CLINIC",
    items: [
      { key: "services", label: "Services", icon: "RiStethoscopeLine", href: (id)=>`/staff/branch/${id}/services`, requiredPerm: "services.view" },
    ],
  },
  {
    group: "People",
    items: [
      { key: "staff", label: "Staff & Shifts", icon: "RiTeamLine", href: (id)=>`/staff/branch/${id}/staff`, requiredPerm: "staff.view" },
    ],
  },
  {
    group: "Analytics",
    items: [
      { key: "reports", label: "Reports", icon: "RiBarChart2Line", href: (id)=>`/staff/branch/${id}/reports`, requiredPerm: "reports.view" },
    ],
  },
];
```

---

## 3) Rendering Algorithm (pseudo)
1. Load `branchId` from route.
2. Fetch `branch summary` -> includes `branch.type` + `myAccess.permissions[]`
3. For each group:
   - if `featureFlag` exists and returns false -> hide group
   - filter items where `requiredPerm` exists in permissions
4. Render sidebar groups and items in WowDash style.

---

## 4) UX Notes
- Always show current branch name on top (click opens branch switcher).
- Show badge counts:
  - Approvals: pending count
  - Inventory: low-stock count
  - Services: today queue count
- If user opens a link without permission -> AccessDenied (don’t show blank page).
