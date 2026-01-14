import { PrismaClient } from '@prisma/client';
import type { SeededCorp } from './seedDhakaCityCorporations';
import type { SeededZones } from './seedDhakaCityZones';

function pad2(n: number) {
  return n.toString().padStart(2, '0');
}
function pad3(n: number) {
  return n.toString().padStart(3, '0');
}
function toBnDigits(input: string | number) {
  const s = String(input);
  const map: Record<string, string> = { '0':'০','1':'১','2':'২','3':'৩','4':'৪','5':'৫','6':'৬','7':'৭','8':'৮','9':'৯' };
  return s.split('').map(ch => map[ch] ?? ch).join('');
}

type WardPlan = { prefix: 'DNCC' | 'DSCC'; zoneAreaIds: number[]; totalWards: number };

/**
 * Seeds wards as BdArea nodes (type = WARD) under zones.
 * DNCC: 54 wards; DSCC: 75 wards (official ward counts).
 *
 * Names:
 *  - English: "Ward 01"
 *  - Bangla:  "ওয়ার্ড ০১"
 */
export default async function seedDhakaCityWards(
  prisma: PrismaClient,
  _corp: SeededCorp,
  zones: SeededZones,
) {
  const plans: WardPlan[] = [
    { prefix: 'DNCC', zoneAreaIds: zones.dnccZoneAreaIds, totalWards: 54 },
    { prefix: 'DSCC', zoneAreaIds: zones.dsccZoneAreaIds, totalWards: 75 },
  ];

  for (const plan of plans) {
    const { prefix, zoneAreaIds, totalWards } = plan;

    // distribute wards deterministically across zones
    let wardNo = 1;
    for (let zi = 0; zi < zoneAreaIds.length; zi++) {
      const zoneId = zoneAreaIds[zi];

      let perZone = Math.floor(totalWards / zoneAreaIds.length);
      const remainder = totalWards % zoneAreaIds.length;
      if (zi < remainder) perZone += 1;

      for (let j = 0; j < perZone && wardNo <= totalWards; j++) {
        const wardNo2 = pad2(wardNo);
        const code = `WARD-${prefix}-${pad3(wardNo)}`;
        const nameEn = `Ward ${wardNo2}`;
        const nameBn = `ওয়ার্ড ${toBnDigits(wardNo2)}`;

        await prisma.bdArea.upsert({
          where: { code },
          update: {
            nameEn,
            nameBn,
            type: 'WARD',
            parentId: zoneId,
            districtId: null,
            upazilaId: null,
          },
          create: {
            code,
            nameEn,
            nameBn,
            type: 'WARD',
            parentId: zoneId,
            districtId: null,
            upazilaId: null,
          },
        });

        wardNo += 1;
      }
    }
  }
}
