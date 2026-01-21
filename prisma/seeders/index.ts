/*
  Seed helpers index (TypeScript)
  - Keeps seed.ts clean
  - Bridges to existing CommonJS dhaka seeders
*/

export async function runDhakaCitySeed(prisma: any) {
  // Prefer the JSON-based seed (expandable), fall back to sample list.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { seedLocationsDhaka } = require('./seedLocationsDhaka');
    if (typeof seedLocationsDhaka === 'function') {
      await seedLocationsDhaka(prisma);
      return;
    }
  } catch (e) {
    // ignore and fall back
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { seedCityCorporationsAndAreas } = require('./seedCityCorporationsAndAreas');
    if (typeof seedCityCorporationsAndAreas === 'function') {
      await seedCityCorporationsAndAreas(prisma);
      return;
    }
  } catch (e) {
    // ignore
  }
}
