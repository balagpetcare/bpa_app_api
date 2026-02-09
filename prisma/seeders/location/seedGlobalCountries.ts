/**
 * Global location countries: BD, IN, LK, MY, SG.
 * Idempotent upsert with phone_code, latitude, longitude.
 * Reference: docs/location/world/GLOBAL_LOCATION_SYSTEM.md
 */

import { PrismaClient } from "@prisma/client";

const GLOBAL_COUNTRIES = [
  { code: "BD", name: "Bangladesh", currencyCode: "BDT", timezoneDefault: "Asia/Dhaka", phoneCode: "+880", latitude: 23.6850, longitude: 90.3563 },
  { code: "IN", name: "India", currencyCode: "INR", timezoneDefault: "Asia/Kolkata", phoneCode: "+91", latitude: 20.5937, longitude: 78.9629 },
  { code: "LK", name: "Sri Lanka", currencyCode: "LKR", timezoneDefault: "Asia/Colombo", phoneCode: "+94", latitude: 7.8731, longitude: 80.7718 },
  { code: "MY", name: "Malaysia", currencyCode: "MYR", timezoneDefault: "Asia/Kuala_Lumpur", phoneCode: "+60", latitude: 4.2105, longitude: 101.9758 },
  { code: "SG", name: "Singapore", currencyCode: "SGD", timezoneDefault: "Asia/Singapore", phoneCode: "+65", latitude: 1.3521, longitude: 103.8198 },
];

export default async function seedGlobalCountries(prisma: PrismaClient): Promise<void> {
  for (const c of GLOBAL_COUNTRIES) {
    await prisma.country.upsert({
      where: { code: c.code },
      update: {
        name: c.name,
        currencyCode: c.currencyCode ?? undefined,
        timezoneDefault: c.timezoneDefault ?? undefined,
        phoneCode: c.phoneCode ?? undefined,
        latitude: c.latitude != null ? c.latitude : undefined,
        longitude: c.longitude != null ? c.longitude : undefined,
        isActive: true,
      },
      create: {
        code: c.code,
        name: c.name,
        currencyCode: c.currencyCode ?? "USD",
        timezoneDefault: c.timezoneDefault ?? "UTC",
        phoneCode: c.phoneCode ?? undefined,
        latitude: c.latitude != null ? c.latitude : undefined,
        longitude: c.longitude != null ? c.longitude : undefined,
        isActive: true,
      },
    });
  }
  console.log(`✅ Global location countries seeded: ${GLOBAL_COUNTRIES.length} (BD, IN, LK, MY, SG)`);
}
