/*
  Seed helpers index (TypeScript)
  - Keeps seed.ts clean
*/

import { PrismaClient } from '@prisma/client';
import { runDhakaCitySeed as runDhakaCityBdAreaSeed } from './dhaka/runDhakaCitySeed';

export async function runDhakaCitySeed(prisma: PrismaClient) {
  await runDhakaCityBdAreaSeed(prisma);
}

export async function runCoverageZoneSeed(prisma: PrismaClient) {
  const seedCoverageZones = (await import('./coverage/seedCoverageZones')).default;
  const seedDhakaNorthCity = (await import('./coverage/seedDhakaNorthCity')).default;
  const seedDhakaSouthCity = (await import('./coverage/seedDhakaSouthCity')).default;
  const seedBusinessCoverageReadiness = (await import('./coverage/seedBusinessCoverageReadiness')).default;

  await seedCoverageZones(prisma);
  await seedDhakaNorthCity(prisma);
  await seedDhakaSouthCity(prisma);
  await seedBusinessCoverageReadiness(prisma);
}
