import { PrismaClient } from '@prisma/client';
import seedDhakaCityCorporations from './seedDhakaCityCorporations';
import seedDhakaCityZones from './seedDhakaCityZones';
import seedDhakaCityAreas from './seedDhakaCityAreas';

export async function runDhakaCitySeed(prisma: PrismaClient) {
  const corp = await seedDhakaCityCorporations(prisma);
  const zones = await seedDhakaCityZones(prisma, corp);
  await seedDhakaCityAreas(prisma, corp, zones);
}
