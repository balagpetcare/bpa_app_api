/**
 * One-time migration: create VerificationCase (DRAFT) for each ProducerOrg that has none.
 * Copies legacy docsJson into payloadJson as notes (no file refs). Idempotent.
 *
 * Run: npx ts-node -r ts-node/register scripts/migrate-producer-kyc-to-verification-case.ts
 * Optional: DRY_RUN=1 to only log, no writes.
 */

const prisma = require("../src/infrastructure/db/prismaClient").default;

const DRY_RUN = String(process.env.DRY_RUN || "0") === "1";

async function main() {
  const orgs = await prisma.producerOrg.findMany({
    select: { id: true, name: true, docsJson: true, legacyDocsJson: true },
  });

  let created = 0;
  let skipped = 0;

  for (const org of orgs) {
    const existing = await prisma.verificationCase.findFirst({
      where: { entityType: "PRODUCER_ORG", entityId: org.id },
      select: { id: true },
    });

    if (existing) {
      skipped++;
      continue;
    }

    const payloadJson =
      org.legacyDocsJson || org.docsJson
        ? { _migratedFrom: "docsJson", legacy: org.legacyDocsJson || org.docsJson }
        : null;

    if (!DRY_RUN) {
      await prisma.verificationCase.create({
        data: {
          entityType: "PRODUCER_ORG",
          entityId: org.id,
          status: "DRAFT",
          payloadJson,
        },
      });
    }
    created++;
    console.log(`ProducerOrg ${org.id} (${org.name}): ${DRY_RUN ? "would create" : "created"} VerificationCase`);
  }

  console.log(`Done. Created: ${created}, Skipped (already have case): ${skipped}. DRY_RUN=${DRY_RUN}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
