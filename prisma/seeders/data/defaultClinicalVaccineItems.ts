export type DefaultClinicalVaccineItemSeed = {
  itemCode: string;
  name: string;
  slug: string;
  description: string;
  aliasNames?: string[];
};

export const DEFAULT_CLINICAL_VACCINE_ITEMS: DefaultClinicalVaccineItemSeed[] = [
  {
    itemCode: "VAC-001",
    name: "Rabies Vaccine",
    slug: "rabies-vaccine",
    description: "Core rabies vaccine for clinic inventory tracking.",
  },
  {
    itemCode: "VAC-002",
    name: "DHPP Vaccine",
    slug: "dhpp-vaccine",
    description: "Canine DHPP combination vaccine for clinic inventory tracking.",
  },
  {
    itemCode: "VAC-003",
    name: "DHLPP Vaccine",
    slug: "dhlpp-vaccine",
    description: "Canine DHLPP combination vaccine for clinic inventory tracking.",
  },
  {
    itemCode: "VAC-004",
    name: "FVRCP Vaccine",
    slug: "fvrcp-vaccine",
    description: "Feline FVRCP combination vaccine for clinic inventory tracking.",
    aliasNames: ["Feline Tricat Vaccine"],
  },
  {
    itemCode: "VAC-005",
    name: "FeLV Vaccine",
    slug: "felv-vaccine",
    description: "Feline leukemia vaccine for clinic inventory tracking.",
    aliasNames: ["Feline Leukemia Vaccine"],
  },
  {
    itemCode: "VAC-006",
    name: "Bordetella Vaccine",
    slug: "bordetella-vaccine",
    description: "Bordetella vaccine for clinic inventory tracking.",
  },
  {
    itemCode: "VAC-007",
    name: "Canine Corona Vaccine",
    slug: "canine-corona-vaccine",
    description: "Canine coronavirus vaccine for clinic inventory tracking.",
    aliasNames: ["Canine Coronavirus Vaccine"],
  },
  {
    itemCode: "VAC-008",
    name: "Canine Parvo Vaccine",
    slug: "canine-parvo-vaccine",
    description: "Canine parvovirus vaccine for clinic inventory tracking.",
  },
  {
    itemCode: "VAC-009",
    name: "Canine Distemper Vaccine",
    slug: "canine-distemper-vaccine",
    description: "Canine distemper vaccine for clinic inventory tracking.",
  },
];
