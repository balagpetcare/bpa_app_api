import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const names = [
  "purchase_orders",
  "purchase_order_lines",
  "allocation_plans",
  "allocation_plan_lines",
  "pick_lists",
  "pick_list_lines",
  "proof_of_deliveries",
  "grns",
];
try {
  const rows = await p.$queryRaw`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN (
        'purchase_orders','purchase_order_lines','allocation_plans','allocation_plan_lines',
        'pick_lists','pick_list_lines','proof_of_deliveries','grns'
      )
    ORDER BY table_name
  `;
  const have = new Set(rows.map((r) => r.table_name));
  for (const n of names) console.log(n + ":", have.has(n) ? "OK" : "MISSING");
  const mig = await p.$queryRaw`
    SELECT migration_name, finished_at FROM _prisma_migrations
    WHERE migration_name LIKE '%20260429120000%' OR migration_name LIKE '%warehouse_enterprise%'
    ORDER BY finished_at DESC NULLS LAST LIMIT 5
  `;
  console.log("migrations:", JSON.stringify(mig, null, 2));
  const grnCol = await p.$queryRaw`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'grns' AND column_name = 'purchaseOrderId'
  `;
  console.log("grns.purchaseOrderId column:", grnCol.length ? "OK" : "MISSING");
  const missing = names.filter((n) => !have.has(n));
  if (missing.length) {
    console.error(
      "\nSome warehouse tables are missing (" +
        missing.join(", ") +
        "). With DATABASE_URL set, from backend-api root run:\n" +
        "  npm run prisma:migrate:deploy\n" +
        "  npm run prisma:generate\n" +
        "  npm run verify:warehouse-enterprise-db"
    );
    process.exitCode = 1;
  }
} finally {
  await p.$disconnect();
}
