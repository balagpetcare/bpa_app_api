/**
 * Delegation-Aware Notification Routing
 * Non-critical events → delegated member (if scope matches)
 * Critical events → owner + delegated member
 */

const prisma = require("../../../infrastructure/db/prismaClient").default;
const { createNotification } = require("./notification.service");

type NotificationInput = {
  type: string;
  title: string;
  message: string;
  meta?: Record<string, unknown>;
  priority?: "P0" | "P1" | "P2";
  actionUrl?: string | null;
  dedupeKey?: string | null;
};

/**
 * Get delegated users for owner who have staff/branches scope for this org/branch
 */
async function getDelegatedRecipients(
  ownerUserId: number,
  orgId: number,
  branchId?: number,
  scopeKey?: string
) {
  const where: Record<string, unknown> = {
    ownerUserId,
    OR: [
      { orgId: null, branchId: null },
      { orgId, branchId: null },
      ...(branchId ? [{ branchId }] : []),
    ],
  };
  if (scopeKey) (where as any).scopeKey = scopeKey;

  const delegations = await prisma.ownerDelegation.findMany({
    where,
    select: { delegatedUserId: true },
    distinct: ["delegatedUserId"],
  });
  return delegations.map((d) => d.delegatedUserId);
}

/**
 * Send notification with delegation-aware routing:
 * - P0/P1 (critical): owner + all delegated users with staff/branches scope
 * - P2 (non-critical): delegated users only (if any), else owner
 */
export async function notifyWithDelegation(
  ownerUserId: number,
  orgId: number,
  branchId: number | undefined,
  input: NotificationInput
) {
  const isCritical = input.priority === "P0" || input.priority === "P1";
  const delegatedUserIds = await getDelegatedRecipients(
    ownerUserId,
    orgId,
    branchId,
    isCritical ? undefined : "staff"
  );

  const recipients = new Set<number>();

  if (isCritical) {
    recipients.add(ownerUserId);
  }

  for (const uid of delegatedUserIds) {
    recipients.add(uid);
  }

  if (recipients.size === 0) {
    recipients.add(ownerUserId);
  }

  const results: { userId: number; created: boolean }[] = [];

  for (const userId of recipients) {
    try {
      const result = await createNotification({
        userId,
        type: input.type as any,
        title: input.title,
        message: input.message,
        meta: input.meta ?? null,
        priority: input.priority ?? "P2",
        actionUrl: input.actionUrl ?? null,
        dedupeKey: input.dedupeKey ? `${input.dedupeKey}:${userId}` : null,
      });
      results.push({ userId, created: result.created });
    } catch (e) {
      console.warn("[DelegationNotification] Failed for user", userId, (e as Error)?.message);
    }
  }

  return results;
}
