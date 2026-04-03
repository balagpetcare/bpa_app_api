-- Repair (P3015): this migration folder previously had no migration.sql, which blocked `prisma migrate deploy`.
--
-- The substantive AiPlanningScope + ai_forecast_snapshots changes are applied by the follow-up migration:
--   20260404120000_wave1_ai_forecast_planning_scope
--
-- This file is intentionally a no-op so migration history remains ordered and deploy can proceed.
-- Safe on databases where those objects already exist: this does not CREATE/DROP tables or data.

SELECT 1;
