require("dotenv").config();

const { PrismaClient } = require("@prisma/client");

async function main() {
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.$queryRawUnsafe(
      "SELECT column_name, is_nullable, column_default FROM information_schema.columns WHERE table_name='notifications' AND column_name IN ('priority','status') ORDER BY column_name"
    );
    console.log(rows);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

