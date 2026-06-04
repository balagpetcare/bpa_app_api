import { PrismaClient } from '@prisma/client';
import seedDhakaCityCorporations from './seedDhakaCityCorporations';
import seedDhakaCityZones from './seedDhakaCityZones';
import seedDhakaCityAreas from './seedDhakaCityAreas';

/**
 * Seeds DSCC courier hierarchy on existing bd_* master (upsert by stable BdArea.code).
 */
export default async function seedDhakaSouthCity(prisma: PrismaClient) {
  const corp = await seedDhakaCityCorporations(prisma);
  const zones = await seedDhakaCityZones(prisma, corp, { corp: 'DSCC' });
  await seedDhakaCityAreas(prisma, corp, zones, { corp: 'DSCC' });
  return { corp, zones };
}
