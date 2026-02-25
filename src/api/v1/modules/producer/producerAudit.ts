const prisma = require("../../../../infrastructure/db/prismaClient");

export async function writeProducerAudit(params: {
  producerOrgId: number;
  actorType: "OWNER" | "STAFF";
  actorId: number;
  action: string;
  entityType: string;
  entityId?: string | null;
}) {
  try {
    const data = {
      producerOrgId: params.producerOrgId,
      actorType: params.actorType,
      actorId: params.actorId,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId ?? null,
    };
    await prisma.producerAuditLog.create({
      data,
    });
  } catch (e) {
  }
}

module.exports = { writeProducerAudit };
