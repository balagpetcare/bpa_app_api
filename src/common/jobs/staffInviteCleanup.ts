/**
 * Periodically marks expired staff invites as EXPIRED.
 *
 * This is a lightweight in-process scheduler (no extra dependency).
 * In production, you may move this to a real cron / worker.
 */

const prisma = require("../../infrastructure/db/prismaClient");

exports.startStaffInviteCleanup = function startStaffInviteCleanup() {
  const intervalMs = Number(process.env.INVITE_CLEANUP_INTERVAL_MS || 15 * 60 * 1000);

  async function runOnce() {
    try {
      const now = new Date();
      const result = await prisma.staffInvite.updateMany({
        where: {
          status: "PENDING",
          expiresAt: { lt: now },
        },
        data: { status: "EXPIRED" },
      });
      if (result?.count) {
        // eslint-disable-next-line no-console
        console.log(`[INVITE_CLEANUP] marked expired: ${result.count}`);
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[INVITE_CLEANUP] error", e);
    }
  }

  // run immediately and then on interval
  runOnce();
  setInterval(runOnce, intervalMs).unref?.();
};

export {};
