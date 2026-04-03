const prisma = require("../../../../infrastructure/db/prismaClient").default;

/** Returns true if the branch exists and belongs to the organization. */
export async function isBranchInOrg(orgId: number, branchId: number): Promise<boolean> {
  const b = await prisma.branch.findFirst({
    where: { id: branchId, orgId },
    select: { id: true },
  });
  return !!b;
}
