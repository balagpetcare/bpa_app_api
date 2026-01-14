/**
 * One-time helper.
 *
 * Legacy behavior:
 *   - On WalletWithdrawRequest create: availableBalance -> pendingBalance
 *
 * New behavior (v14):
 *   - On create: availableBalance -> lockedBalance (reserve)
 *   - On payout start (PROCESSING): lockedBalance -> pendingBalance
 *
 * This script migrates existing reserved requests that are not processing yet:
 *   - For each wallet: sum amounts of requests in SUBMITTED/UNDER_REVIEW/QUEUED/APPROVED
 *     and move that amount from pendingBalance -> lockedBalance (if possible).
 *
 * Notes:
 * - Run with: node scripts/migrate_withdraw_reserve_to_locked.js
 * - Requires DATABASE_URL in env (same as app).
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const candidates = await prisma.walletWithdrawRequest.findMany({
    where: { status: { in: ['SUBMITTED', 'UNDER_REVIEW', 'QUEUED', 'APPROVED'] } },
    select: { id: true, walletId: true, amount: true },
  });

  const byWallet = new Map();
  for (const r of candidates) {
    const key = r.walletId;
    const cur = byWallet.get(key) || 0;
    byWallet.set(key, cur + Number(r.amount));
  }

  let changed = 0;
  for (const [walletId, sum] of byWallet.entries()) {
    if (!sum || sum <= 0) continue;
    const wallet = await prisma.userWallet.findUnique({ where: { id: walletId } });
    if (!wallet) continue;

    const pending = Number(wallet.pendingBalance || 0);
    const move = Math.min(pending, sum);
    if (move <= 0) continue;

    await prisma.userWallet.update({
      where: { id: walletId },
      data: {
        pendingBalance: { decrement: move },
        lockedBalance: { increment: move },
      },
    });

    changed += 1;
    console.log(`Wallet #${walletId}: moved ${move} from pending -> locked`);
  }

  console.log(`Done. Updated wallets: ${changed}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
