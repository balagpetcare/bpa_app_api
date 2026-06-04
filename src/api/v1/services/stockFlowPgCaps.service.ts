/**
 * Detect optional DB columns for stock-flow tooling (works before migrate deploy).
 * After `20260429120500_enterprise_allocation_post_foundation`, `enterpriseSupersededAt`
 * exists on fresh deploys; this probe remains for mixed environments / partial migrations.
 */
import prisma from "../../../infrastructure/db/prismaClient";

let enterpriseSupersededColumnCached: boolean | null = null;

/** True after migration adds stock_transfers.enterpriseSupersededAt */
export async function stockTransfersEnterpriseSupersededColumnExists(): Promise<boolean> {
  if (enterpriseSupersededColumnCached !== null) return enterpriseSupersededColumnCached;
  const r = await prisma.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS (
      SELECT 1
      FROM pg_attribute a
      INNER JOIN pg_class c ON c.oid = a.attrelid
      INNER JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = current_schema()
        AND c.relname = 'stock_transfers'
        AND a.attname = 'enterpriseSupersededAt'
        AND a.attnum > 0
        AND NOT a.attisdropped
    ) AS exists
  `;
  enterpriseSupersededColumnCached = Boolean(r[0]?.exists);
  return enterpriseSupersededColumnCached;
}

/** Reset in tests only */
export function resetStockFlowPgCapsCache(): void {
  enterpriseSupersededColumnCached = null;
}
