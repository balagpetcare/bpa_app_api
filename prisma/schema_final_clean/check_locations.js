const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

(async () => {
  try {
    const [divisions, districts, upazilas, areas] = await Promise.all([
      prisma.bdDivision.count(),
      prisma.bdDistrict.count(),
      prisma.bdUpazila.count(),
      prisma.bdArea.count(),
    ]);

    console.log("Divisions", divisions);
    console.log("Districts", districts);
    console.log("Upazilas", upazilas);
    console.log("Areas", areas);

    const dhakaDiv = await prisma.bdDivision.findFirst({ where: { nameEn: { contains: "Dhaka" } } });
    console.log("Dhaka Division:", dhakaDiv);

    if (dhakaDiv) {
      const dhakaDistricts = await prisma.bdDistrict.findMany({
        where: { divisionId: dhakaDiv.id },
        select: { code: true, nameEn: true, nameBn: true },
        take: 5,
        orderBy: { id: "asc" },
      });
      console.log("Sample districts in Dhaka Division (first 5):", dhakaDistricts);
    }
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
})();
