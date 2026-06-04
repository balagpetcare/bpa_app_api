/**
 * Repair stock flow data inconsistencies (procurement demand gaps, legacy vs enterprise transfers).
 *
 * Env:
 *   FLOW_ORG_ID (optional) — limit to one org
 *   REPAIR_LIMIT (default 200) — max plans / conflict rows scanned per phase
 *   REPAIR_ACTOR_USER_ID (optional) — warehouse audit actor
 *
 * CLI:
 *   Default: dry-run only (no writes).
 *   Pass --apply to execute repairs.
 *
 * Run: npm run repair:stock-flow
 *      npm run repair:stock-flow -- --apply
 */
import "dotenv/config";
import {
  findLegacyEnterpriseTransferConflicts,
  findShortageDemandGaps,
  runStockFlowRepair,
} from "../src/api/v1/services/stockFlowRepair.service";

function parseArgs(argv: string[]) {
  const apply = argv.includes("--apply");
  return { apply };
}

async function main() {
  const { apply } = parseArgs(process.argv.slice(2));
  const dryRun = !apply;
  const orgId = process.env.FLOW_ORG_ID ? Number(process.env.FLOW_ORG_ID) : null;
  const limit = Math.min(500, Math.max(20, Number(process.env.REPAIR_LIMIT || 200) || 200));
  const actorUserId = process.env.REPAIR_ACTOR_USER_ID ? Number(process.env.REPAIR_ACTOR_USER_ID) : null;

  console.log("=== repairStockFlowData ===\n");
  console.log(`Mode: ${dryRun ? "DRY-RUN (no writes). Use --apply to mutate." : "APPLY (writes enabled)"}`);
  if (orgId != null && Number.isFinite(orgId)) console.log(`Org filter: ${orgId}`);
  console.log(`Limit: ${limit}\n`);

  const shortageGaps = await findShortageDemandGaps({ orgId: orgId ?? undefined, limit });
  console.log(`[detect] Shortage plans missing demand lines for planId (post-confirm): ${shortageGaps.length}`);
  for (const g of shortageGaps.slice(0, 50)) {
    console.log(
      `  plan=${g.planId} org=${g.orgId} sr=${g.stockRequestId} shortageQty=${g.shortageQty} demandForPlan=${g.demandLinesForPlan}`
    );
  }
  if (shortageGaps.length > 50) console.log(`  ... and ${shortageGaps.length - 50} more`);

  const legacy = await findLegacyEnterpriseTransferConflicts({ orgId: orgId ?? undefined, limit });
  console.log(`\n[detect] Legacy StockTransfer vs active allocation plan rows: ${legacy.length}`);
  for (const c of legacy.slice(0, 50)) {
    console.log(
      `  transfer=${c.transferId} status=${c.transferStatus} sr=${c.stockRequestId} plan=${c.planId} planStatus=${c.planStatus}`
    );
  }
  if (legacy.length > 50) console.log(`  ... and ${legacy.length - 50} more`);

  console.log("\n--- running repair pass ---\n");
  const summary = await runStockFlowRepair({
    dryRun,
    orgId: orgId ?? undefined,
    limit,
    actorUserId: Number.isFinite(actorUserId!) && actorUserId! > 0 ? actorUserId : null,
  });

  console.log("=== Summary ===");
  console.log(JSON.stringify(summary, null, 2));

  if (summary.errors.length) {
    console.log("\nErrors (manual follow-up may be required):");
    for (const e of summary.errors) {
      console.log(`  [${e.step}] ${e.message} ${e.ref ?? ""}`);
    }
  }

  console.log("\nNext: npm run audit:flow (expect 0 issues after successful apply + migration deploy).");
  process.exit(summary.errors.length > 0 && !dryRun ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
