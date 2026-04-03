-- Idempotent alignment: Prisma model Warehouse.poOverReceiptTolerancePercent (enterprise GRN PO line over-receipt tolerance).
-- Also present in 20260403140000_enterprise_grn_po_line_barcode_void; this migration repairs DBs that drifted (column missing while migration history advanced).
-- Safe no-op when the column already exists.
ALTER TABLE "warehouses" ADD COLUMN IF NOT EXISTS "poOverReceiptTolerancePercent" DECIMAL(5,2);
