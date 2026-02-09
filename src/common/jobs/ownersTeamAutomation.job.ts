/**
 * Owners Team Management Automation Job
 *
 * Schedule:
 * - Checks (integrity verify): every 1 hour
 * - Sync users & permissions: every 6 hours
 * - Audit trail export: daily at 00:00
 *
 * @see docs/OWNERS_TEAM_MANAGEMENT_AUTOMATION.md
 */

const {
  syncUsersAndRoles,
  exportAuditTrail,
  runIntegrityChecks,
  sendAlert,
} = require("../services/ownersTeamAutomation.service");

const CHECK_INTERVAL_MS = Number(process.env.OWNERS_CHECK_INTERVAL_MS || 60 * 60 * 1000);
const SYNC_INTERVAL_MS = Number(process.env.OWNERS_SYNC_INTERVAL_MS || 6 * 60 * 60 * 1000);

let lastAuditExportDate: string | null = null;

async function runChecks() {
  try {
    const { ok, anomalies } = await runIntegrityChecks();
    if (!ok && anomalies?.length) {
      await sendAlert("sensitive", "Permission integrity anomaly detected", { anomalies });
      console.warn("[OWNERS_AUTOMATION] Anomalies:", anomalies);
    }
  } catch (e) {
    console.error("[OWNERS_AUTOMATION] Checks error:", (e as Error).message);
    await sendAlert("sync_error", "Owners automation checks failed", { error: (e as Error).message });
  }
}

async function runSync() {
  try {
    const result = await syncUsersAndRoles();
    if (!result.success) {
      await sendAlert("sync_error", "Owners sync failed", { error: result.error });
      console.error("[OWNERS_AUTOMATION] Sync failed:", result.error);
      return;
    }
    console.log(
      `[OWNERS_AUTOMATION] Sync ok: owners=${result.ownersCount ?? "?"} teamMembers=${result.teamMembersCount ?? "?"} (${result.duration}ms)`
    );
  } catch (e) {
    console.error("[OWNERS_AUTOMATION] Sync error:", (e as Error).message);
    await sendAlert("sync_error", "Owners sync error", { error: (e as Error).message });
  }
}

async function runAuditExport() {
  try {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const result = await exportAuditTrail(yesterday);
    if (!result.success) {
      await sendAlert("sync_error", "Audit export failed", { error: result.error });
      console.error("[OWNERS_AUTOMATION] Audit export failed:", result.error);
      return;
    }
    console.log(`[OWNERS_AUTOMATION] Audit exported: ${result.path} (${result.count ?? 0} entries, ${result.duration}ms)`);
  } catch (e) {
    console.error("[OWNERS_AUTOMATION] Audit export error:", (e as Error).message);
    await sendAlert("sync_error", "Audit export error", { error: (e as Error).message });
  }
}

function shouldRunDailyAudit(): boolean {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  if (lastAuditExportDate === today) return false;
  if (now.getUTCHours() === 0 && now.getUTCMinutes() < 5) {
    lastAuditExportDate = today;
    return true;
  }
  return false;
}

export function startOwnersTeamAutomation() {
  if (process.env.OWNERS_AUTOMATION_ENABLED === "0") {
    console.log("[OWNERS_AUTOMATION] Disabled (OWNERS_AUTOMATION_ENABLED=0)");
    return;
  }

  console.log("[OWNERS_AUTOMATION] Starting (check=1h, sync=6h, audit=daily 00:00)");

  runChecks().catch(() => {});
  runSync().catch(() => {});

  setInterval(runChecks, CHECK_INTERVAL_MS).unref?.();
  setInterval(runSync, SYNC_INTERVAL_MS).unref?.();

  setInterval(() => {
    if (shouldRunDailyAudit()) {
      runAuditExport().catch(() => {});
    }
  }, 5 * 60 * 1000).unref?.();
}

export async function runOwnersTeamAutomationOnce() {
  await runChecks();
  await runSync();
  await runAuditExport();
}
