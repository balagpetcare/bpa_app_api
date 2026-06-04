/**
 * Seed branded included vaccines for a campaign by slug.
 * Usage: node scripts/seed-campaign-included-vaccines.js [slug]
 * Default slug: cat-flu-rabies-2026 (override via CAMPAIGN_SEED_SLUG)
 */

require("dotenv").config();
const { PrismaPg } = require("@prisma/adapter-pg");
const { PrismaClient } = require("@prisma/client");
const { Pool } = require("pg");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const DEFAULT_PACKAGE_FEATURES = [
  "Injection Administration",
  "Syringe & Consumables",
  "BPA Digital Certificate",
  "QR Verification",
];

const DEFAULT_VACCINES = [
  {
    name: "PUREVAX® Feline 4",
    description: "Feline combination vaccine (Boehringer Ingelheim PUREVAX® line).",
    coveredDiseases: [
      "Feline Panleukopenia (FPV)",
      "Feline Herpesvirus (FHV-1)",
      "Feline Calicivirus (FCV)",
      "Chlamydia felis",
    ],
    displayOrder: 0,
  },
  {
    name: "Rabies Vaccine",
    description: "Rabies vaccination per campaign protocol.",
    coveredDiseases: ["Rabies"],
    displayOrder: 1,
  },
];

async function main() {
  const slug = process.argv[2] || process.env.CAMPAIGN_SEED_SLUG || "cat-flu-rabies-2026";
  const campaign = await prisma.campaign.findUnique({ where: { slug } });
  if (!campaign) {
    console.error(`Campaign not found for slug: ${slug}`);
    process.exit(1);
  }

  if (campaign.vaccineCost == null && campaign.serviceCharge == null) {
    await prisma.campaign.update({
      where: { id: campaign.id },
      data: {
        vaccineCost: 500,
        serviceCharge: 100,
        priceAmount: 600,
        packageFeatures: DEFAULT_PACKAGE_FEATURES,
        pricingType: campaign.pricingType === "FREE" ? "PAID" : campaign.pricingType,
      },
    });
    console.log("Updated campaign pricing: vaccine 500 + service 100 = total 600");
  }

  const existing = await prisma.campaignIncludedVaccine.count({
    where: { campaignId: campaign.id },
  });
  if (existing > 0) {
    console.log(`Campaign ${slug} already has ${existing} included vaccine(s). Skipping vaccine seed.`);
    return;
  }

  for (const row of DEFAULT_VACCINES) {
    await prisma.campaignIncludedVaccine.create({
      data: {
        campaignId: campaign.id,
        name: row.name,
        description: row.description,
        coveredDiseases: row.coveredDiseases,
        displayOrder: row.displayOrder,
      },
    });
  }

  console.log(`Seeded ${DEFAULT_VACCINES.length} included vaccines for campaign "${campaign.name}" (${slug}).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
