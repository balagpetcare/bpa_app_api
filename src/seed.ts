import { prisma } from "./lib/prisma";

async function main() {
  // Minimal seed for current schema.
  // Ensure at least one SuperAdminWhitelist entry if env provided.
  const email = process.env.SEED_SUPERADMIN_EMAIL || null;
  const phone = process.env.SEED_SUPERADMIN_PHONE || null;

  if (email || phone) {
    await prisma.superAdminWhitelist.upsert({
      where: { id: 1 },
      create: { id: 1, email, phone, isActive: true } as any,
      update: { email, phone, isActive: true } as any,
    });
  }

  console.log("✅ Seed done");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
