
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

export async function dhakaCityCorps(req, res) {
  const corps = await prisma.bdArea.findMany({
    where: { type: "CITY_CORP" },
    select: { id: true, code: true, nameEn: true, nameBn: true }
  });
  res.json(corps);
}

export async function dhakaSearch(req, res) {
  const { corpId, q = "", limit = 20 } = req.query;
  if (!corpId) return res.status(400).json({ message: "corpId required" });

  const results = await prisma.bdArea.findMany({
    where: {
      AND: [
        { OR: [
          { nameEn: { contains: q, mode: "insensitive" }},
          { nameBn: { contains: q }}
        ]},
        { OR: [
          { parentId: Number(corpId) },
          { parent: { parentId: Number(corpId) }}
        ]}
      ]
    },
    take: Number(limit),
    select: {
      id: true, nameEn: true, nameBn: true, type: true,
      parent: { select: { nameEn: true }}
    }
  });

  const mapped = results.map(r => ({
    id: r.id,
    nameEn: r.nameEn,
    nameBn: r.nameBn,
    type: r.type,
    path: r.parent ? r.parent.nameEn + " > " + r.nameEn : r.nameEn
  }));

  res.json(mapped);
}
