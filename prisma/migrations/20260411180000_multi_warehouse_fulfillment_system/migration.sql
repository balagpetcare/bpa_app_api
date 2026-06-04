-- Placeholder: original migration referenced allocation_plans / warehouses before those objects existed
-- (timestamp 20260411 runs before 20260428150000 warehouses and 20260429120000 allocation_plans).
-- The additive multi-warehouse DDL was moved to 20260429130000_multi_warehouse_fulfillment_system.
-- This migration remains in the chain for ordering and checksum continuity.
SELECT 1;
