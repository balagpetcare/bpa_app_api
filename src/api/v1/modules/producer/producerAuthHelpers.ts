/**
 * Single source of truth for "is this user the producer org owner?".
 * Use in services where req is not available (e.g. approval service).
 */
const prisma = require("../../../../infrastructure/db/prismaClient");

export async function resolveProducerActorIsOwner(
  userId: number,
  producerOrgId: number
): Promise<boolean> {
  const org = await prisma.producerOrg.findFirst({
    where: { id: Number(producerOrgId), ownerUserId: Number(userId) },
    select: { id: true },
  });
  return !!org;
}
