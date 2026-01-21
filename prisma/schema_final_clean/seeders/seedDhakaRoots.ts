
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

export async function seedDhakaRoots() {
  const dhaka = await prisma.bdDistrict.findFirst({ where: { nameEn: "Dhaka" }});
  if (!dhaka) throw new Error("Dhaka district not found");

  const roots = [
    { code: "DHK-DNCC", nameEn: "Dhaka North City Corporation", nameBn: "ঢাকা উত্তর সিটি কর্পোরেশন" },
    { code: "DHK-DSCC", nameEn: "Dhaka South City Corporation", nameBn: "ঢাকা দক্ষিণ সিটি কর্পোরেশন" }
  ];

  for (const r of roots) {
    await prisma.bdArea.upsert({
      where: { code: r.code },
      update: {},
      create: {
        code: r.code,
        nameEn: r.nameEn,
        nameBn: r.nameBn,
        type: "CITY_CORP",
        districtId: dhaka.id
      }
    });
  }
}
