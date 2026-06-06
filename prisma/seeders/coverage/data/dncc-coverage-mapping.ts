/** DNCC city corporation → all DNCC zone + area BdArea codes (seeded under CC-DNCC). */
export const DNCC_COVERAGE = {
  name: 'Dhaka North City Corporation (DNCC)',
  slug: 'dncc',
  description: 'Operational coverage aligned to DNCC localities',
  bdAreaCodes: [
    'CC-DNCC',
    'ZONE-DNCC-UTTARA',
    'ZONE-DNCC-AIRPORT',
    'ZONE-DNCC-DAKKHINKHAN',
    'ZONE-DNCC-UTTARKHAN',
    'ZONE-DNCC-KHILKHET',
    'ZONE-DNCC-BADDA',
    'ZONE-DNCC-GULSHAN',
    'ZONE-DNCC-TEJGAON',
    'ZONE-DNCC-MOHAMMADPUR',
    'ZONE-DNCC-SHER_E_BANGLA_NAGAR',
    'ZONE-DNCC-MIRPUR',
    'ZONE-DNCC-PALLABI',
    'ZONE-DNCC-KAFRUL',
  ],
} as const;
