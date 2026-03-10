/**
 * One-time migration: create DoctorLicense records from existing DoctorVerification
 * where licenseNumber and registrationBody are set but no licenses exist.
 * Matches by primaryCountryCode or registration body name/abbreviation.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const COUNTRY_FROM_BODY: Record<string, string> = {
  BMDC: "BD",
  BVC: "BD",
  "Bangladesh Veterinary Council": "BD",
  VCI: "IN",
  "Veterinary Council of India": "IN",
  PVMC: "PK",
  RCVS: "GB",
  "Royal College of Veterinary Surgeons": "GB",
  AVMA: "US",
  SAVC: "ZA",
  VCNZ: "NZ",
};

async function findBodyForVerification(
  primaryCountryCode: string | null,
  registrationBody: string | null
): Promise<number | null> {
  const code = (primaryCountryCode || "").trim().toUpperCase();
  const bodyName = (registrationBody || "").trim();

  if (code) {
    const country = await prisma.vetCountry.findUnique({ where: { code } });
    if (country) {
      const body = await prisma.vetRegulatoryBody.findFirst({
        where: { countryId: country.id, isActive: true },
        orderBy: { id: "asc" },
      });
      if (body) return body.id;
    }
  }

  if (bodyName) {
    const upper = bodyName.toUpperCase();
    const byAbbr = await prisma.vetRegulatoryBody.findFirst({
      where: {
        isActive: true,
        OR: [
          { abbreviation: { equals: upper, mode: "insensitive" } },
          { name: { contains: bodyName, mode: "insensitive" } },
        ],
      },
    });
    if (byAbbr) return byAbbr.id;

    const inferredCountry = COUNTRY_FROM_BODY[upper] || COUNTRY_FROM_BODY[bodyName];
    if (inferredCountry) {
      const country = await prisma.vetCountry.findUnique({ where: { code: inferredCountry } });
      if (country) {
        const body = await prisma.vetRegulatoryBody.findFirst({
          where: { countryId: country.id, isActive: true },
          orderBy: { id: "asc" },
        });
        if (body) return body.id;
      }
    }
  }

  return null;
}

async function main() {
  const verifications = await prisma.doctorVerification.findMany({
    where: {
      licenseNumber: { not: null },
      licenses: { none: {} },
    },
    include: { licenses: true },
  });

  let created = 0;
  let skipped = 0;

  for (const v of verifications) {
    const licenseNumber = (v.licenseNumber || "").trim();
    if (!licenseNumber) {
      skipped++;
      continue;
    }

    const bodyId = await findBodyForVerification(
      v.primaryCountryCode,
      v.registrationBody
    );

    if (!bodyId) {
      console.log(`Skip verification ${v.id}: no matching regulatory body for country=${v.primaryCountryCode} body=${v.registrationBody}`);
      skipped++;
      continue;
    }

    try {
      await prisma.doctorLicense.create({
        data: {
          doctorVerificationId: v.id,
          regulatoryBodyId: bodyId,
          licenseNumber,
          licenseStatus: "ACTIVE",
          isPrimary: true,
        },
      });
      created++;
      console.log(`Created DoctorLicense for verification ${v.id} (user ${v.userId})`);
    } catch (e: any) {
      if (e?.code === "P2002") {
        console.log(`Already exists: verification ${v.id}`);
        skipped++;
      } else {
        throw e;
      }
    }
  }

  console.log(`Done. Created ${created}, skipped ${skipped}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
