-- Ensure staff_invites.warehouseId -> warehouses.id FK exists after warehouses table is created.
-- 20260401143000_staff_invites_warehouse_target skips this FK when warehouses does not exist yet (shadow DB / ordering).

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'warehouses'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'staff_invites' AND column_name = 'warehouseId'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'public'
      AND constraint_name = 'staff_invites_warehouseId_fkey'
      AND table_name = 'staff_invites'
  ) THEN
    ALTER TABLE "staff_invites"
      ADD CONSTRAINT "staff_invites_warehouseId_fkey"
      FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
