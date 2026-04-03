/**
 * Ensures product variants belong to the organization's catalog (Product.orgId).
 */
import prisma from "../../../../infrastructure/db/prismaClient";

export async function assertVariantsBelongToOrg(orgId: number, variantIds: number[]): Promise<void> {
  const unique = [...new Set(variantIds)].filter((id) => Number.isInteger(id) && id > 0);
  if (!unique.length) return;
  const rows = await prisma.productVariant.findMany({
    where: { id: { in: unique }, product: { orgId } },
    select: { id: true },
  });
  if (rows.length !== unique.length) {
    throw new Error("One or more variants are not in this organization's product catalog");
  }
}
