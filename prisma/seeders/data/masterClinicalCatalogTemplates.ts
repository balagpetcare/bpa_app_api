/**
 * Master clinical catalog templates.
 * Each template includes categories (by slug) and/or items (by slug); includeSubcategories means include all items under that category.
 */
export type MasterTemplateSeed = {
  slug: string;
  name: string;
  description: string | null;
  version: string;
  categorySlugs: string[]; // include full category (all items in that category)
  itemSlugs: string[];    // additional specific items not already in selected categories
};

export const MASTER_CLINICAL_CATALOG_TEMPLATES: MasterTemplateSeed[] = [
  {
    slug: "standard-veterinary-clinic",
    name: "Standard Veterinary Clinic",
    description: "Full set of categories and common items for a general practice veterinary clinic.",
    version: "1.0.0",
    categorySlugs: [
      "surgical-consumables", "medical-consumables", "medications", "vaccines",
      "diagnostic-supplies", "laboratory", "surgical-instruments", "anesthesia-supplies",
      "emergency-supplies", "wound-care", "iv-catheter-supplies", "sterilization-cssd",
      "ppe-safety", "sample-collection", "disposal-biomedical", "packaging-dispensing", "misc-clinical",
    ],
    itemSlugs: [],
  },
  {
    slug: "advanced-surgical-clinic",
    name: "Advanced Surgical Clinic",
    description: "Surgery-focused: instruments, consumables, anesthesia, OT and sterilization.",
    version: "1.0.0",
    categorySlugs: [
      "surgical-consumables", "surgical-instruments", "anesthesia-supplies",
      "iv-catheter-supplies", "sterilization-cssd", "ppe-safety", "emergency-supplies",
      "wound-care", "disposal-biomedical",
    ],
    itemSlugs: ["surgical-pack", "syringe", "needle", "scalpel-blade", "blade-handle", "gauze", "sterile-drapes", "catgut-suture", "nylon-suture", "forceps", "needle-holder", "iv-cannula", "iv-set", "et-tube", "oxygen-mask", "sharps-container", "biohazard-bag"],
  },
  {
    slug: "small-animal-clinic",
    name: "Small Animal Clinic",
    description: "General small animal practice: medicines, vaccines, consumables, wound care.",
    version: "1.0.0",
    categorySlugs: [
      "medications", "vaccines", "medical-consumables", "surgical-consumables",
      "wound-care", "diagnostic-supplies", "sample-collection", "ppe-safety",
      "packaging-dispensing", "disposal-biomedical",
    ],
    itemSlugs: ["rabies-vaccine", "dhpp-vaccine", "dewormer", "antibiotic-injection", "painkiller-injection", "saline", "syringe", "needle", "gauze", "bandage", "dressing-pad", "examination-gloves", "surgical-gloves", "urine-container", "blood-collection-tube", "sample-swab", "medicine-pouch", "label-sticker", "sharps-container"],
  },
  {
    slug: "vaccination-focused-clinic",
    name: "Vaccination-Focused Clinic",
    description: "Vaccines, syringes, cold chain and basic consumables.",
    version: "1.0.0",
    categorySlugs: ["vaccines", "medications", "medical-consumables", "ppe-safety", "sample-collection", "packaging-dispensing", "disposal-biomedical"],
    itemSlugs: ["rabies-vaccine", "dhpp-vaccine", "syringe", "needle", "examination-gloves", "antiseptic-solution", "medicine-pouch", "label-sticker", "sharps-container", "biohazard-bag"],
  },
  {
    slug: "diagnostic-clinic",
    name: "Diagnostic Clinic",
    description: "Lab, sample collection, diagnostic supplies and related consumables.",
    version: "1.0.0",
    categorySlugs: ["diagnostic-supplies", "laboratory", "sample-collection", "medical-consumables", "ppe-safety", "disposal-biomedical"],
    itemSlugs: ["urine-container", "blood-collection-tube", "sample-swab", "examination-gloves", "antiseptic-solution", "sharps-container", "biohazard-bag"],
  },
  // Starter packs from CSV seed (prisma/seed-data/complete_veterinary_master_catalog.csv)
  {
    slug: "basic-veterinary-starter",
    name: "Basic Veterinary Starter",
    description: "Core categories from the veterinary master catalog: medicines, injectables, antibiotics, pain, surgical consumables.",
    version: "1.0.0",
    categorySlugs: ["medicines", "injectables", "antibiotics", "pain", "surgical-consumables"],
    itemSlugs: [],
  },
  {
    slug: "surgery-starter",
    name: "Surgery Starter",
    description: "Surgery-focused: surgical consumables, sutures, blades, gauze, instruments, scissors, forceps.",
    version: "1.0.0",
    categorySlugs: ["surgical-consumables", "sutures", "blades", "gauze", "instruments", "scissors", "forceps"],
    itemSlugs: [],
  },
  {
    slug: "ot-starter",
    name: "OT Starter",
    description: "OT supplies and disposables from the master catalog.",
    version: "1.0.0",
    categorySlugs: ["ot-supplies", "disposables"],
    itemSlugs: [],
  },
  {
    slug: "medicines-starter",
    name: "Medicines Starter",
    description: "Medicines, injectables, antibiotics and pain categories.",
    version: "1.0.0",
    categorySlugs: ["medicines", "injectables", "antibiotics", "pain"],
    itemSlugs: [],
  },
  {
    slug: "full-clinic-starter",
    name: "Full Clinic Starter",
    description: "All categories from the veterinary master catalog (325 items).",
    version: "1.0.0",
    categorySlugs: [
      "medicines", "injectables", "antibiotics", "pain", "surgical-consumables",
      "sutures", "blades", "gauze", "instruments", "scissors", "forceps",
      "ot-supplies", "disposables",
    ],
    itemSlugs: [],
  },
];
