-- Phase 5: extend warehouse audit enum for operational lifecycle events (PO, pick, POD, allocation).
ALTER TYPE "WarehouseAuditCategory" ADD VALUE 'OPERATIONS';
