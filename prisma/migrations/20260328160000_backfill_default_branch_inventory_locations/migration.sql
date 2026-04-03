-- Idempotent: one default SHOP inventory location per branch that has none.
-- Matches scripts/backfill-default-inventory-locations.ts and runtime ensureDefaultBranchInventoryLocation.

INSERT INTO "inventory_locations" ("branchId", "type", "name", "code", "isActive", "createdAt", "updatedAt")
SELECT
  b.id,
  'SHOP'::"InventoryLocationType",
  CASE
    WHEN b.name IS NOT NULL AND TRIM(b.name) <> '' THEN b.name || ' - Main'
    ELSE 'Main'
  END,
  NULL,
  true,
  NOW(),
  NOW()
FROM "branches" b
WHERE NOT EXISTS (
  SELECT 1 FROM "inventory_locations" il WHERE il."branchId" = b.id
);
