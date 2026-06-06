import { PrismaClient } from '@prisma/client';

export type BdAreaHierarchy = {
  bdAreaId: number;
  bdUnionId: number | null;
  bdUpazilaId: number | null;
  bdDistrictId: number | null;
};

export async function resolveBdAreaByCode(
  prisma: PrismaClient,
  code: string,
): Promise<BdAreaHierarchy | null> {
  const area = await prisma.bdArea.findUnique({
    where: { code },
    select: {
      id: true,
      unionId: true,
      upazilaId: true,
      districtId: true,
    },
  });
  if (!area) return null;
  return {
    bdAreaId: area.id,
    bdUnionId: area.unionId,
    bdUpazilaId: area.upazilaId,
    bdDistrictId: area.districtId,
  };
}
