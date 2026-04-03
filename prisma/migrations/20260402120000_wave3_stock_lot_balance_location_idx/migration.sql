-- Wave-3 hardening: faster quarantine / location-scoped lot balance scans
CREATE INDEX IF NOT EXISTS "stock_lot_balances_locationId_idx" ON "stock_lot_balances"("locationId");
