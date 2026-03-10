/**
 * Master clinical catalog items for veterinary clinics.
 * categorySlug must match a slug in MASTER_CLINICAL_CATALOG_CATEGORIES.
 */
import { ClinicalItemDomain } from "@prisma/client";

export type MasterItemSeed = {
  itemCode: string;
  name: string;
  slug: string;
  categorySlug: string;
  domainType: ClinicalItemDomain;
  baseUnit?: string | null;
  description?: string | null;
  isPackageEligible: boolean;
  isInventoryTracked: boolean;
  requiresBatch: boolean;
  requiresExpiry: boolean;
  isReusable: boolean;
  defaultReorderLevel?: number | null;
  defaultMinStock?: number | null;
  defaultMaxStock?: number | null;
  coldChainRequired: boolean;
  controlledItem: boolean;
  usageNoteTemplate?: string | null;
};

export const MASTER_CLINICAL_CATALOG_ITEMS: MasterItemSeed[] = [
  // Surgical consumables
  { itemCode: "SYR-001", name: "Syringe", slug: "syringe", categorySlug: "surgical-consumables", domainType: ClinicalItemDomain.SURGICAL_CONSUMABLE, baseUnit: "pc", isPackageEligible: true, isInventoryTracked: true, requiresBatch: false, requiresExpiry: false, isReusable: false, coldChainRequired: false, controlledItem: false },
  { itemCode: "NDL-001", name: "Needle", slug: "needle", categorySlug: "surgical-consumables", domainType: ClinicalItemDomain.SURGICAL_CONSUMABLE, baseUnit: "pc", isPackageEligible: true, isInventoryTracked: true, requiresBatch: false, requiresExpiry: false, isReusable: false, coldChainRequired: false, controlledItem: false },
  { itemCode: "SUT-001", name: "Catgut Suture", slug: "catgut-suture", categorySlug: "surgical-consumables", domainType: ClinicalItemDomain.SURGICAL_CONSUMABLE, baseUnit: "pck", isPackageEligible: true, isInventoryTracked: true, requiresBatch: true, requiresExpiry: true, isReusable: false, coldChainRequired: false, controlledItem: false },
  { itemCode: "SUT-002", name: "Nylon Suture", slug: "nylon-suture", categorySlug: "surgical-consumables", domainType: ClinicalItemDomain.SURGICAL_CONSUMABLE, baseUnit: "pck", isPackageEligible: true, isInventoryTracked: true, requiresBatch: false, requiresExpiry: false, isReusable: false, coldChainRequired: false, controlledItem: false },
  { itemCode: "BLD-001", name: "Scalpel Blade", slug: "scalpel-blade", categorySlug: "surgical-consumables", domainType: ClinicalItemDomain.SURGICAL_CONSUMABLE, baseUnit: "pc", isPackageEligible: true, isInventoryTracked: true, requiresBatch: false, requiresExpiry: false, isReusable: false, coldChainRequired: false, controlledItem: false },
  { itemCode: "BLD-002", name: "Blade Handle", slug: "blade-handle", categorySlug: "surgical-consumables", domainType: ClinicalItemDomain.SURGICAL_CONSUMABLE, baseUnit: "pc", isPackageEligible: true, isInventoryTracked: true, requiresBatch: false, requiresExpiry: false, isReusable: true, coldChainRequired: false, controlledItem: false },
  { itemCode: "GAU-001", name: "Gauze", slug: "gauze", categorySlug: "surgical-consumables", domainType: ClinicalItemDomain.SURGICAL_CONSUMABLE, baseUnit: "pck", isPackageEligible: true, isInventoryTracked: true, requiresBatch: false, requiresExpiry: false, isReusable: false, coldChainRequired: false, controlledItem: false },
  { itemCode: "DRP-001", name: "Sterile Drapes", slug: "sterile-drapes", categorySlug: "surgical-consumables", domainType: ClinicalItemDomain.SURGICAL_CONSUMABLE, baseUnit: "pck", isPackageEligible: true, isInventoryTracked: true, requiresBatch: false, requiresExpiry: true, isReusable: false, coldChainRequired: false, controlledItem: false },
  // Medical consumables
  { itemCode: "COT-001", name: "Cotton", slug: "cotton", categorySlug: "medical-consumables", domainType: ClinicalItemDomain.CLINIC_SUPPLY, baseUnit: "pck", isPackageEligible: true, isInventoryTracked: true, requiresBatch: false, requiresExpiry: false, isReusable: false, coldChainRequired: false, controlledItem: false },
  { itemCode: "BND-001", name: "Bandage", slug: "bandage", categorySlug: "wound-care", domainType: ClinicalItemDomain.DRESSING_SUPPLY, baseUnit: "roll", isPackageEligible: true, isInventoryTracked: true, requiresBatch: false, requiresExpiry: false, isReusable: false, coldChainRequired: false, controlledItem: false },
  { itemCode: "BND-002", name: "Elastic Bandage", slug: "elastic-bandage", categorySlug: "wound-care", domainType: ClinicalItemDomain.DRESSING_SUPPLY, baseUnit: "roll", isPackageEligible: true, isInventoryTracked: true, requiresBatch: false, requiresExpiry: false, isReusable: false, coldChainRequired: false, controlledItem: false },
  { itemCode: "DRS-001", name: "Dressing Pad", slug: "dressing-pad", categorySlug: "wound-care", domainType: ClinicalItemDomain.DRESSING_SUPPLY, baseUnit: "pc", isPackageEligible: true, isInventoryTracked: true, requiresBatch: false, requiresExpiry: false, isReusable: false, coldChainRequired: false, controlledItem: false },
  { itemCode: "TAP-001", name: "Tape", slug: "tape", categorySlug: "wound-care", domainType: ClinicalItemDomain.DRESSING_SUPPLY, baseUnit: "roll", isPackageEligible: true, isInventoryTracked: true, requiresBatch: false, requiresExpiry: false, isReusable: false, coldChainRequired: false, controlledItem: false },
  { itemCode: "GLV-001", name: "Surgical Gloves", slug: "surgical-gloves", categorySlug: "ppe-safety", domainType: ClinicalItemDomain.CLINIC_SUPPLY, baseUnit: "box", isPackageEligible: true, isInventoryTracked: true, requiresBatch: false, requiresExpiry: true, isReusable: false, coldChainRequired: false, controlledItem: false },
  { itemCode: "GLV-002", name: "Examination Gloves", slug: "examination-gloves", categorySlug: "ppe-safety", domainType: ClinicalItemDomain.CLINIC_SUPPLY, baseUnit: "box", isPackageEligible: true, isInventoryTracked: true, requiresBatch: false, requiresExpiry: true, isReusable: false, coldChainRequired: false, controlledItem: false },
  { itemCode: "ANT-001", name: "Antiseptic Solution", slug: "antiseptic-solution", categorySlug: "medical-consumables", domainType: ClinicalItemDomain.CLINIC_SUPPLY, baseUnit: "bottle", isPackageEligible: true, isInventoryTracked: true, requiresBatch: false, requiresExpiry: true, isReusable: false, coldChainRequired: false, controlledItem: false },
  { itemCode: "DIS-001", name: "Disinfectant", slug: "disinfectant", categorySlug: "medical-consumables", domainType: ClinicalItemDomain.CLINIC_SUPPLY, baseUnit: "bottle", isPackageEligible: true, isInventoryTracked: true, requiresBatch: false, requiresExpiry: true, isReusable: false, coldChainRequired: false, controlledItem: false },
  // IV / Catheter
  { itemCode: "IVC-001", name: "IV Cannula", slug: "iv-cannula", categorySlug: "iv-catheter-supplies", domainType: ClinicalItemDomain.CLINIC_SUPPLY, baseUnit: "pc", isPackageEligible: true, isInventoryTracked: true, requiresBatch: false, requiresExpiry: false, isReusable: false, coldChainRequired: false, controlledItem: false },
  { itemCode: "IVS-001", name: "IV Set", slug: "iv-set", categorySlug: "iv-catheter-supplies", domainType: ClinicalItemDomain.CLINIC_SUPPLY, baseUnit: "pc", isPackageEligible: true, isInventoryTracked: true, requiresBatch: false, requiresExpiry: false, isReusable: false, coldChainRequired: false, controlledItem: false },
  { itemCode: "CAT-001", name: "Catheter", slug: "catheter", categorySlug: "iv-catheter-supplies", domainType: ClinicalItemDomain.CLINIC_SUPPLY, baseUnit: "pc", isPackageEligible: true, isInventoryTracked: true, requiresBatch: false, requiresExpiry: false, isReusable: false, coldChainRequired: false, controlledItem: false },
  // Medications
  { itemCode: "MED-001", name: "Saline", slug: "saline", categorySlug: "medications", domainType: ClinicalItemDomain.MEDICINE, baseUnit: "bag", isPackageEligible: true, isInventoryTracked: true, requiresBatch: true, requiresExpiry: true, isReusable: false, coldChainRequired: false, controlledItem: false },
  { itemCode: "MED-002", name: "RL", slug: "rl", categorySlug: "medications", domainType: ClinicalItemDomain.MEDICINE, baseUnit: "bag", isPackageEligible: true, isInventoryTracked: true, requiresBatch: true, requiresExpiry: true, isReusable: false, coldChainRequired: false, controlledItem: false },
  { itemCode: "MED-003", name: "Dextrose", slug: "dextrose", categorySlug: "medications", domainType: ClinicalItemDomain.MEDICINE, baseUnit: "bottle", isPackageEligible: true, isInventoryTracked: true, requiresBatch: true, requiresExpiry: true, isReusable: false, coldChainRequired: false, controlledItem: false },
  { itemCode: "MED-004", name: "Antibiotic Injection", slug: "antibiotic-injection", categorySlug: "medications", domainType: ClinicalItemDomain.MEDICINE, baseUnit: "vial", isPackageEligible: true, isInventoryTracked: true, requiresBatch: true, requiresExpiry: true, isReusable: false, coldChainRequired: true, controlledItem: false },
  { itemCode: "MED-005", name: "Painkiller Injection", slug: "painkiller-injection", categorySlug: "medications", domainType: ClinicalItemDomain.MEDICINE, baseUnit: "amp", isPackageEligible: true, isInventoryTracked: true, requiresBatch: true, requiresExpiry: true, isReusable: false, coldChainRequired: false, controlledItem: false },
  { itemCode: "MED-006", name: "Anti-inflammatory", slug: "anti-inflammatory", categorySlug: "medications", domainType: ClinicalItemDomain.MEDICINE, baseUnit: "tab", isPackageEligible: true, isInventoryTracked: true, requiresBatch: true, requiresExpiry: true, isReusable: false, coldChainRequired: false, controlledItem: false },
  { itemCode: "MED-007", name: "Dewormer", slug: "dewormer", categorySlug: "medications", domainType: ClinicalItemDomain.MEDICINE, baseUnit: "tab", isPackageEligible: true, isInventoryTracked: true, requiresBatch: true, requiresExpiry: true, isReusable: false, coldChainRequired: false, controlledItem: false },
  // Vaccines
  { itemCode: "VAC-001", name: "Rabies Vaccine", slug: "rabies-vaccine", categorySlug: "vaccines", domainType: ClinicalItemDomain.MEDICINE, baseUnit: "dose", isPackageEligible: true, isInventoryTracked: true, requiresBatch: true, requiresExpiry: true, isReusable: false, coldChainRequired: true, controlledItem: false },
  { itemCode: "VAC-002", name: "DHPP Vaccine", slug: "dhpp-vaccine", categorySlug: "vaccines", domainType: ClinicalItemDomain.MEDICINE, baseUnit: "dose", isPackageEligible: true, isInventoryTracked: true, requiresBatch: true, requiresExpiry: true, isReusable: false, coldChainRequired: true, controlledItem: false },
  // Anesthesia / Emergency
  { itemCode: "ANE-001", name: "Oxygen Mask", slug: "oxygen-mask", categorySlug: "anesthesia-supplies", domainType: ClinicalItemDomain.CLINIC_SUPPLY, baseUnit: "pc", isPackageEligible: true, isInventoryTracked: true, requiresBatch: false, requiresExpiry: false, isReusable: true, coldChainRequired: false, controlledItem: false },
  { itemCode: "ANE-002", name: "ET Tube", slug: "et-tube", categorySlug: "anesthesia-supplies", domainType: ClinicalItemDomain.CLINIC_SUPPLY, baseUnit: "pc", isPackageEligible: true, isInventoryTracked: true, requiresBatch: false, requiresExpiry: false, isReusable: false, coldChainRequired: false, controlledItem: false },
  { itemCode: "ANE-003", name: "Suction Tube", slug: "suction-tube", categorySlug: "anesthesia-supplies", domainType: ClinicalItemDomain.CLINIC_SUPPLY, baseUnit: "pc", isPackageEligible: true, isInventoryTracked: true, requiresBatch: false, requiresExpiry: false, isReusable: false, coldChainRequired: false, controlledItem: false },
  { itemCode: "ANE-004", name: "Feeding Tube", slug: "feeding-tube", categorySlug: "anesthesia-supplies", domainType: ClinicalItemDomain.CLINIC_SUPPLY, baseUnit: "pc", isPackageEligible: true, isInventoryTracked: true, requiresBatch: false, requiresExpiry: false, isReusable: false, coldChainRequired: false, controlledItem: false },
  // Sample collection
  { itemCode: "SMP-001", name: "Urine Container", slug: "urine-container", categorySlug: "sample-collection", domainType: ClinicalItemDomain.CLINIC_SUPPLY, baseUnit: "pc", isPackageEligible: true, isInventoryTracked: true, requiresBatch: false, requiresExpiry: false, isReusable: false, coldChainRequired: false, controlledItem: false },
  { itemCode: "SMP-002", name: "Blood Collection Tube", slug: "blood-collection-tube", categorySlug: "sample-collection", domainType: ClinicalItemDomain.CLINIC_SUPPLY, baseUnit: "pc", isPackageEligible: true, isInventoryTracked: true, requiresBatch: false, requiresExpiry: true, isReusable: false, coldChainRequired: false, controlledItem: false },
  { itemCode: "SMP-003", name: "Sample Swab", slug: "sample-swab", categorySlug: "sample-collection", domainType: ClinicalItemDomain.CLINIC_SUPPLY, baseUnit: "pck", isPackageEligible: true, isInventoryTracked: true, requiresBatch: false, requiresExpiry: true, isReusable: false, coldChainRequired: false, controlledItem: false },
  // Procedure kits (conceptual - can map to surgical-consumables or medical-consumables)
  { itemCode: "KIT-001", name: "Surgical Pack", slug: "surgical-pack", categorySlug: "surgical-consumables", domainType: ClinicalItemDomain.PACKAGE_ONLY, baseUnit: "pack", isPackageEligible: true, isInventoryTracked: true, requiresBatch: false, requiresExpiry: true, isReusable: false, coldChainRequired: false, controlledItem: false },
  { itemCode: "KIT-002", name: "PPE Kit", slug: "ppe-kit", categorySlug: "ppe-safety", domainType: ClinicalItemDomain.CLINIC_SUPPLY, baseUnit: "pack", isPackageEligible: true, isInventoryTracked: true, requiresBatch: false, requiresExpiry: false, isReusable: false, coldChainRequired: false, controlledItem: false },
  // Disposal
  { itemCode: "DSP-001", name: "Sharps Container", slug: "sharps-container", categorySlug: "disposal-biomedical", domainType: ClinicalItemDomain.CLINIC_SUPPLY, baseUnit: "pc", isPackageEligible: false, isInventoryTracked: true, requiresBatch: false, requiresExpiry: false, isReusable: false, coldChainRequired: false, controlledItem: false },
  { itemCode: "DSP-002", name: "Biohazard Bag", slug: "biohazard-bag", categorySlug: "disposal-biomedical", domainType: ClinicalItemDomain.CLINIC_SUPPLY, baseUnit: "roll", isPackageEligible: false, isInventoryTracked: true, requiresBatch: false, requiresExpiry: false, isReusable: false, coldChainRequired: false, controlledItem: false },
  // Packaging
  { itemCode: "PKG-001", name: "Medicine Pouch", slug: "medicine-pouch", categorySlug: "packaging-dispensing", domainType: ClinicalItemDomain.CLINIC_SUPPLY, baseUnit: "pck", isPackageEligible: false, isInventoryTracked: true, requiresBatch: false, requiresExpiry: false, isReusable: false, coldChainRequired: false, controlledItem: false },
  { itemCode: "PKG-002", name: "Label Sticker", slug: "label-sticker", categorySlug: "packaging-dispensing", domainType: ClinicalItemDomain.CLINIC_SUPPLY, baseUnit: "roll", isPackageEligible: false, isInventoryTracked: true, requiresBatch: false, requiresExpiry: false, isReusable: false, coldChainRequired: false, controlledItem: false },
  // Instruments
  { itemCode: "INS-001", name: "Forceps", slug: "forceps", categorySlug: "surgical-instruments", domainType: ClinicalItemDomain.INSTRUMENT, baseUnit: "pc", isPackageEligible: true, isInventoryTracked: true, requiresBatch: false, requiresExpiry: false, isReusable: true, coldChainRequired: false, controlledItem: false },
  { itemCode: "INS-002", name: "Needle Holder", slug: "needle-holder", categorySlug: "surgical-instruments", domainType: ClinicalItemDomain.INSTRUMENT, baseUnit: "pc", isPackageEligible: true, isInventoryTracked: true, requiresBatch: false, requiresExpiry: false, isReusable: true, coldChainRequired: false, controlledItem: false },
];
