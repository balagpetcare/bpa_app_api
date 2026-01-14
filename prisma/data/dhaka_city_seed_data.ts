/**
 * Dhaka City seed data (DNCC + DSCC) – includes key neighbourhoods like Rampura & Banasree.
 * You can extend this list safely; keep `code` unique.
 */
export const dhakaCitySeedData = {
  division: { code: 'BD-DHAKA-DIV', nameEn: 'Dhaka', nameBn: 'ঢাকা' },
  district: { code: 'BD-DHAKA-DIST', nameEn: 'Dhaka', nameBn: 'ঢাকা' },

  cityCorporations: [
    { code: 'DNCC', nameEn: 'Dhaka North City Corporation', nameBn: 'ঢাকা উত্তর সিটি কর্পোরেশন' },
    { code: 'DSCC', nameEn: 'Dhaka South City Corporation', nameBn: 'ঢাকা দক্ষিণ সিটি কর্পোরেশন' }
  ],

  // Keep codes stable so upsert works.
  zones: [
    // DSCC
    { code: 'DSCC-Z1',  nameEn: 'Zone 1',  nameBn: 'জোন ১',  cityCorporationCode: 'DSCC' },
    { code: 'DSCC-Z2',  nameEn: 'Zone 2',  nameBn: 'জোন ২',  cityCorporationCode: 'DSCC' },
    { code: 'DSCC-Z3',  nameEn: 'Zone 3',  nameBn: 'জোন ৩',  cityCorporationCode: 'DSCC' },
    { code: 'DSCC-Z4',  nameEn: 'Zone 4',  nameBn: 'জোন ৪',  cityCorporationCode: 'DSCC' },
    { code: 'DSCC-Z5',  nameEn: 'Zone 5',  nameBn: 'জোন ৫',  cityCorporationCode: 'DSCC' },

    // DNCC
    { code: 'DNCC-Z1',  nameEn: 'Zone 1',  nameBn: 'জোন ১',  cityCorporationCode: 'DNCC' },
    { code: 'DNCC-Z2',  nameEn: 'Zone 2',  nameBn: 'জোন ২',  cityCorporationCode: 'DNCC' },
    { code: 'DNCC-Z3',  nameEn: 'Zone 3',  nameBn: 'জোন ৩',  cityCorporationCode: 'DNCC' },
    { code: 'DNCC-Z4',  nameEn: 'Zone 4',  nameBn: 'জোন ৪',  cityCorporationCode: 'DNCC' },
    { code: 'DNCC-Z5',  nameEn: 'Zone 5',  nameBn: 'জোন ৫',  cityCorporationCode: 'DNCC' }
  ],

  // Ward codes are illustrative. If you already have official ward IDs/codes, replace them here.
  wards: [
    // DSCC wards (examples to host common areas)
    { code: 'DSCC-W19', nameEn: 'Ward 19', nameBn: 'ওয়ার্ড ১৯', zoneCode: 'DSCC-Z4', cityCorporationCode: 'DSCC' },
    { code: 'DSCC-W22', nameEn: 'Ward 22', nameBn: 'ওয়ার্ড ২২', zoneCode: 'DSCC-Z5', cityCorporationCode: 'DSCC' },
    { code: 'DSCC-W23', nameEn: 'Ward 23', nameBn: 'ওয়ার্ড ২৩', zoneCode: 'DSCC-Z5', cityCorporationCode: 'DSCC' },
    { code: 'DSCC-W24', nameEn: 'Ward 24', nameBn: 'ওয়ার্ড ২৪', zoneCode: 'DSCC-Z5', cityCorporationCode: 'DSCC' },
    { code: 'DSCC-W25', nameEn: 'Ward 25', nameBn: 'ওয়ার্ড ২৫', zoneCode: 'DSCC-Z5', cityCorporationCode: 'DSCC' },

    // DNCC wards (examples)
    { code: 'DNCC-W01', nameEn: 'Ward 1',  nameBn: 'ওয়ার্ড ১',  zoneCode: 'DNCC-Z1', cityCorporationCode: 'DNCC' },
    { code: 'DNCC-W02', nameEn: 'Ward 2',  nameBn: 'ওয়ার্ড ২',  zoneCode: 'DNCC-Z1', cityCorporationCode: 'DNCC' },
    { code: 'DNCC-W03', nameEn: 'Ward 3',  nameBn: 'ওয়ার্ড ৩',  zoneCode: 'DNCC-Z2', cityCorporationCode: 'DNCC' }
  ],

  // Areas are what your dropdown shows (Rampura, Banasree, etc.)
  areas: [
    // ✅ Must-have (your request)
    { code: 'DSCC-A-RAMPURA',  nameEn: 'Rampura',  nameBn: 'রামপুরা',  wardCode: 'DSCC-W22', cityCorporationCode: 'DSCC' },
    { code: 'DSCC-A-BANASREE', nameEn: 'Banasree', nameBn: 'বনশ্রী',   wardCode: 'DSCC-W23', cityCorporationCode: 'DSCC' },

    // Common DSCC neighbourhoods (extend as needed)
    { code: 'DSCC-A-MALIBAGH',   nameEn: 'Malibagh',   nameBn: 'মালিবাগ',   wardCode: 'DSCC-W19', cityCorporationCode: 'DSCC' },
    { code: 'DSCC-A-KHILGAON',   nameEn: 'Khilgaon',   nameBn: 'খিলগাঁও',   wardCode: 'DSCC-W24', cityCorporationCode: 'DSCC' },
    { code: 'DSCC-A-MUGDA',      nameEn: 'Mugda',      nameBn: 'মুগদা',     wardCode: 'DSCC-W25', cityCorporationCode: 'DSCC' },
    { code: 'DSCC-A-SHANTINAGAR',nameEn: 'Shantinagar',nameBn: 'শান্তিনগর', wardCode: 'DSCC-W19', cityCorporationCode: 'DSCC' },
    { code: 'DSCC-A-MOTIJHEEL',  nameEn: 'Motijheel',  nameBn: 'মতিঝিল',    wardCode: 'DSCC-W19', cityCorporationCode: 'DSCC' },

    // DNCC examples
    { code: 'DNCC-A-GULSHAN',  nameEn: 'Gulshan',  nameBn: 'গুলশান',  wardCode: 'DNCC-W02', cityCorporationCode: 'DNCC' },
    { code: 'DNCC-A-BANANI',   nameEn: 'Banani',   nameBn: 'বনানী',   wardCode: 'DNCC-W02', cityCorporationCode: 'DNCC' },
    { code: 'DNCC-A-MIRPUR',   nameEn: 'Mirpur',   nameBn: 'মিরপুর',  wardCode: 'DNCC-W03', cityCorporationCode: 'DNCC' },
    { code: 'DNCC-A-UTTARA',   nameEn: 'Uttara',   nameBn: 'উত্তরা',  wardCode: 'DNCC-W01', cityCorporationCode: 'DNCC' }
  ]
};