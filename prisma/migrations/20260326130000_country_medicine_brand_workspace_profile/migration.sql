-- Columns workspaceProfileJson, reviewStatus + index are created with country_medicine_brands in 20260403120000_medicine_catalog_import.
-- No-op preserves migration filename for history; avoids ALTER before table exists on shadow DB replay.
SELECT 1;
