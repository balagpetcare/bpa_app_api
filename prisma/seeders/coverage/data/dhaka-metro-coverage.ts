/** Dhaka Metro operational zones → existing BdArea.code (from dhaka city seeders). */
export const DHAKA_METRO_ROOT = {
  name: 'Dhaka Metro',
  slug: 'dhaka-metro',
  description: 'BPA Dhaka metropolitan operational coverage',
  sortOrder: 0,
} as const;

export const DHAKA_METRO_ZONES: Array<{
  name: string;
  slug: string;
  sortOrder: number;
  bdAreaCodes: string[];
}> = [
  {
    name: 'North Zone',
    slug: 'dhaka-metro-north',
    sortOrder: 1,
    bdAreaCodes: [
      'AREA-DNCC-UTTARA-UTTARA',
      ...Array.from({ length: 18 }, (_, i) => `AREA-DNCC-UTTARA-SECTOR-${String(i + 1).padStart(2, '0')}`),
      'AREA-DNCC-AIRPORT-AIRPORT',
      'AREA-DNCC-KHILKHET-KHILKHET',
      'AREA-DNCC-UTTARA-TONGI-BORDER',
    ],
  },
  {
    name: 'West Zone',
    slug: 'dhaka-metro-west',
    sortOrder: 2,
    bdAreaCodes: [
      'AREA-DNCC-MIRPUR-01',
      'AREA-DNCC-MIRPUR-02',
      'AREA-DNCC-MIRPUR-06',
      'AREA-DNCC-MIRPUR-10',
      'AREA-DNCC-MIRPUR-11',
      'AREA-DNCC-MIRPUR-12',
      'AREA-DNCC-PALLABI-PALLABI',
      'AREA-DNCC-KAFRUL-KAFRUL',
      'AREA-DNCC-SHER_E_BANGLA_NAGAR-AGARGAON',
    ],
  },
  {
    name: 'Central Zone',
    slug: 'dhaka-metro-central',
    sortOrder: 3,
    bdAreaCodes: [
      'AREA-DNCC-GULSHAN-BANANI',
      'AREA-DNCC-GULSHAN-01',
      'AREA-DNCC-GULSHAN-02',
      'AREA-DNCC-GULSHAN-MOHAKHALI',
      'AREA-DNCC-TEJGAON-TEJGAON',
      'AREA-DNCC-GULSHAN-NIKETAN',
    ],
  },
  {
    name: 'East Zone',
    slug: 'dhaka-metro-east',
    sortOrder: 4,
    bdAreaCodes: [
      'AREA-DNCC-BADDA-BADDA',
      'AREA-DSCC-RAMPURA-RAMPURA',
      'AREA-DNCC-BADDA-BASHUNDHARA',
      'AREA-DNCC-BADDA-AFTABNAGAR',
      'AREA-DNCC-BADDA-VATARA',
    ],
  },
  {
    name: 'South Zone',
    slug: 'dhaka-metro-south',
    sortOrder: 5,
    bdAreaCodes: [
      'AREA-DSCC-DHANMONDI-DHANMONDI',
      'AREA-DNCC-MOHAMMADPUR-MOHAMMADPUR',
      'AREA-DSCC-LALBAGH-LALBAGH',
      'AREA-DSCC-NEW_MARKET-AZIMPUR',
      'AREA-DSCC-RAMNA-SHAHBAGH',
      'AREA-DSCC-MOTIJHEEL-MOTIJHEEL',
      'AREA-DSCC-MOTIJHEEL-WARI',
      'AREA-DSCC-JATRABARI-JATRABARI',
      'AREA-DSCC-OLD_DHAKA-SUTRAPUR',
      'AREA-DSCC-KHILGAON-KHILGAON',
      'AREA-DSCC-KHILGAON-MUGDA',
    ],
  },
];
