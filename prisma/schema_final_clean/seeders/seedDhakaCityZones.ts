import { PrismaClient } from '@prisma/client';
import type { SeededCorp } from './seedDhakaCityCorporations';

/**
 * Seeds courier-style "zones" (broad regions / thanas / hubs) as BdArea nodes.
 *
 * We intentionally avoid numeric DNCC/DSCC administrative zone numbers here,
 * because end-users recognize locations by locality names (Uttara, Mirpur, Gulshan...).
 */

export type SeededZones = {
  dncc: Record<string, number>; // code -> BdArea.id
  dscc: Record<string, number>; // code -> BdArea.id
};

type ZoneSeed = {
  corp: 'DNCC' | 'DSCC';
  code: string;
  nameEn: string;
  nameBn: string;
};

const ZONES: ZoneSeed[] = [
  // ---------------- DNCC ----------------
  { corp: 'DNCC', code: 'DNCC-UTTARA', nameEn: 'Uttara', nameBn: 'উত্তরা' },
  { corp: 'DNCC', code: 'DNCC-AIRPORT', nameEn: 'Airport / Kawla', nameBn: 'এয়ারপোর্ট / কাওলা' },
  { corp: 'DNCC', code: 'DNCC-DAKKHINKHAN', nameEn: 'Dakshinkhan', nameBn: 'দক্ষিণখান' },
  { corp: 'DNCC', code: 'DNCC-UTTARKHAN', nameEn: 'Uttarkhan', nameBn: 'উত্তরখান' },
  { corp: 'DNCC', code: 'DNCC-KHILKHET', nameEn: 'Khilkhet', nameBn: 'খিলক্ষেত' },
  { corp: 'DNCC', code: 'DNCC-BADDA', nameEn: 'Badda', nameBn: 'বাড্ডা' },
  { corp: 'DNCC', code: 'DNCC-GULSHAN', nameEn: 'Gulshan / Banani / Baridhara', nameBn: 'গুলশান / বনানী / বারিধারা' },
  { corp: 'DNCC', code: 'DNCC-TEJGAON', nameEn: 'Tejgaon / Farmgate', nameBn: 'তেজগাঁও / ফার্মগেট' },
  { corp: 'DNCC', code: 'DNCC-MOHAMMADPUR', nameEn: 'Mohammadpur / Adabor', nameBn: 'মোহাম্মদপুর / আদাবর' },
  { corp: 'DNCC', code: 'DNCC-SHER_E_BANGLA_NAGAR', nameEn: 'Sher-e-Bangla Nagar / Agargaon', nameBn: 'শেরেবাংলা নগর / আগারগাঁও' },
  { corp: 'DNCC', code: 'DNCC-MIRPUR', nameEn: 'Mirpur', nameBn: 'মিরপুর' },
  { corp: 'DNCC', code: 'DNCC-PALLABI', nameEn: 'Pallabi / ECB', nameBn: 'পল্লবী / ইসিবি' },
  { corp: 'DNCC', code: 'DNCC-KAFRUL', nameEn: 'Kafrul / Cantonment', nameBn: 'কাফরুল / ক্যান্টনমেন্ট' },

  // ---------------- DSCC ----------------
  { corp: 'DSCC', code: 'DSCC-DHANMONDI', nameEn: 'Dhanmondi / Kalabagan', nameBn: 'ধানমন্ডি / কলাবাগান' },
  { corp: 'DSCC', code: 'DSCC-NEW_MARKET', nameEn: 'New Market / Azimpur', nameBn: 'নিউ মার্কেট / আজিমপুর' },
  { corp: 'DSCC', code: 'DSCC-RAMNA', nameEn: 'Ramna / Shahbag', nameBn: 'রমনা / শাহবাগ' },
  { corp: 'DSCC', code: 'DSCC-PALTAN', nameEn: 'Paltan / Kakrail', nameBn: 'পল্টন / কাকরাইল' },
  { corp: 'DSCC', code: 'DSCC-MOTIJHEEL', nameEn: 'Motijheel / Kamalapur', nameBn: 'মতিঝিল / কমলাপুর' },
  { corp: 'DSCC', code: 'DSCC-KHILGAON', nameEn: 'Khilgaon / Malibagh', nameBn: 'খিলগাঁও / মালিবাগ' },
  { corp: 'DSCC', code: 'DSCC-RAMPURA', nameEn: 'Rampura / Banasree', nameBn: 'রামপুরা / বনশ্রী' },
  { corp: 'DSCC', code: 'DSCC-BASHABO', nameEn: 'Basabo / Sabujbagh', nameBn: 'বাসাবো / সবুজবাগ' },
  { corp: 'DSCC', code: 'DSCC-JATRABARI', nameEn: 'Jatrabari / Dhania / Donia', nameBn: 'যাত্রাবাড়ী / ধানিয়া / ডনিয়া' },
  { corp: 'DSCC', code: 'DSCC-DEMRA', nameEn: 'Demra / Matuail', nameBn: 'ডেমরা / মাতুয়াইল' },
  { corp: 'DSCC', code: 'DSCC-SHYAMPUR', nameEn: 'Shyampur / Jurain', nameBn: 'শ্যামপুর / জুরাইন' },
  { corp: 'DSCC', code: 'DSCC-OLD_DHAKA', nameEn: 'Old Dhaka (Kotwali / Sutrapur)', nameBn: 'পুরান ঢাকা (কোতোয়ালি / সূত্রাপুর)' },
  { corp: 'DSCC', code: 'DSCC-LALBAGH', nameEn: 'Lalbagh / Kamrangirchar', nameBn: 'লালবাগ / কামরাঙ্গীরচর' },
  { corp: 'DSCC', code: 'DSCC-HAZARIBAGH', nameEn: 'Hazaribagh / Rayerbazar', nameBn: 'হাজারীবাগ / রায়েরবাজার' },
];

export default async function seedDhakaCityZones(prisma: PrismaClient, corp: SeededCorp): Promise<SeededZones> {
  const dncc: Record<string, number> = {};
  const dscc: Record<string, number> = {};

  for (const z of ZONES) {
    const parentId = z.corp === 'DNCC' ? corp.dnccAreaId : corp.dsccAreaId;
    const rec = await prisma.bdArea.upsert({
      where: { code: `ZONE-${z.code}` },
      update: {
        nameEn: z.nameEn,
        nameBn: z.nameBn,
        type: 'ZONE',
        districtId: corp.dhakaDistrictId,
        parentId,
        upazilaId: null,
      },
      create: {
        code: `ZONE-${z.code}`,
        nameEn: z.nameEn,
        nameBn: z.nameBn,
        type: 'ZONE',
        districtId: corp.dhakaDistrictId,
        parentId,
        upazilaId: null,
      },
    });

    if (z.corp === 'DNCC') dncc[`ZONE-${z.code}`] = rec.id;
    else dscc[`ZONE-${z.code}`] = rec.id;
  }

  return { dncc, dscc };
}
