/**
 * Global location seeders: countries, states, cities, sub-districts.
 * Run after seedCountries. Idempotent (UPSERT).
 * Reference: docs/location/world/GLOBAL_LOCATION_SYSTEM.md
 */

import { PrismaClient } from "@prisma/client";
import seedGlobalCountries from "./seedGlobalCountries";
import seedGlobalStates from "./seedGlobalStates";
import seedGlobalCities from "./seedGlobalCities";
import seedGlobalSubDistricts from "./seedGlobalSubDistricts";

export async function runGlobalLocationSeed(prisma: PrismaClient): Promise<void> {
  await seedGlobalCountries(prisma);
  await seedGlobalStates(prisma);
  await seedGlobalCities(prisma);
  await seedGlobalSubDistricts(prisma);
}

export { default as seedGlobalCountries } from "./seedGlobalCountries";
export { default as seedGlobalStates } from "./seedGlobalStates";
export { default as seedGlobalCities } from "./seedGlobalCities";
export { default as seedGlobalSubDistricts } from "./seedGlobalSubDistricts";
