/**
 * Set vaccineCost + serviceCharge when only priceAmount exists.
 * Usage: node scripts/backfill-campaign-pricing-split.js <slug> <vaccineCost> <serviceCharge>
 * Example: node scripts/backfill-campaign-pricing-split.js cat-flu-rabies-2026 500 100
 */
require("dotenv").config();
const { PrismaPg } = require("@prisma/adapter-pg");
const { PrismaClient } = require("@prisma/client");
const { Pool } = require("pg");

const slug = process.argv[2];
const vaccineCost = Number(process.argv[3]);
const serviceCharge = Number(process.argv[4]);

if (!slug || !Number.isFinite(vaccineCost) || !Number.isFinite(serviceCharge)) {
  console.error(
    "Usage: node scripts/backfill-campaign-pricing-split.js <slug> <vaccineCost> <serviceCharge>"
  );
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  const campaign = await prisma.campaign.findUnique({ where: { slug } });
  if (!campaign) {
    console.error(`Campaign not found: ${slug}`);
    process.exit(1);
  }

  const total = vaccineCost + serviceCharge;
  await prisma.campaign.update({
    where: { id: campaign.id },
    data: {
      vaccineCost,
      serviceCharge,
      priceAmount: total,
      pricingType: campaign.pricingType === "FREE" ? "PAID" : campaign.pricingType,
    },
  });

  console.log(
    `Updated "${campaign.name}": vaccine ${vaccineCost} + service ${serviceCharge} = total ${total}`
  );
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
