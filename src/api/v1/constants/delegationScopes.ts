/**
 * Owner Delegation scope keys and their permission mappings.
 * Scopes: products, clinics, inventory, staff, branches, finance_read
 * Used by scope-based permission engine to filter delegated access.
 */

export const DELEGATION_SCOPE_KEYS = [
  "products",
  "clinics",
  "inventory",
  "staff",
  "branches",
  "finance_read",
] as const;

export type DelegationScopeKey = (typeof DELEGATION_SCOPE_KEYS)[number];

/** Permissions granted by each scope. Scope is an ADDITIONAL filter on top of role. */
export const SCOPE_TO_PERMISSIONS: Record<string, string[]> = {
  products: [
    "product.read",
    "product.write",
    "product.create",
    "product.update",
    "product.delete",
    "owner.products.manage",
    "products.read",
    "products.write",
  ],
  clinics: [
    "clinic.appointments.read",
    "clinic.appointments.manage",
    "clinic.patients.read",
    "clinic.patients.manage",
    "services.read",
    "services.write",
  ],
  inventory: [
    "inventory.read",
    "inventory.write",
    "inventory.receive",
    "inventory.adjust",
    "inventory.transfer",
    "inventory.ledger.view",
  ],
  staff: [
    "staff.read",
    "staff.write",
    "staff.create",
    "branches.read",
  ],
  branches: [
    "branches.read",
    "branches.write",
    "branch.read",
    "branch.write",
    "branch.create",
  ],
  finance_read: [
    "reports.read",
    "orders.read",
    "customers.read",
  ],
};

export function isValidScopeKey(key: string): key is DelegationScopeKey {
  return DELEGATION_SCOPE_KEYS.includes(key as DelegationScopeKey);
}

/** Scopes that grant read-only access; used by API to block write actions. */
export const READ_ONLY_SCOPE_KEYS: readonly string[] = ["finance_read"];
