import { PrismaClient } from '@prisma/client';
import seedDhakaCityCorporations from './seedDhakaCityCorporations';
import seedDhakaCityZones from './seedDhakaCityZones';
import seedDhakaCityAreas from './seedDhakaCityAreas';

/**
 * Seeds DNCC courier hierarchy on existing bd_* master (upsert by stable BdArea.code).
 * Requires `npm run seed:location-master` first.
 */
export default async function seedDhakaNorthCity(prisma: PrismaClient) {
  const corp = await seedDhakaCityCorporations(prisma);
  const zones = await seedDhakaCityZones(prisma, corp, { corp: 'DNCC' });
  await seedDhakaCityAreas(prisma, corp, zones, { corp: 'DNCC' });
  return { corp, zones };
}
