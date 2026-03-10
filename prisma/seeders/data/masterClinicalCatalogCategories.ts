/**
 * Master clinical catalog categories for veterinary clinics.
 * Used by seedMasterClinicalCatalog. Add or edit here to extend the global catalog.
 */
import { ClinicalItemDomain } from "@prisma/client";

export type MasterCategorySeed = {
  slug: string;
  name: string;
  parentSlug?: string | null;
  domainType: ClinicalItemDomain | null;
  sortOrder: number;
  description?: string | null;
  isEssential: boolean;
  inventoryTracked: boolean;
  packageEligible: boolean;
  prescriptionEligible: boolean;
  supplyRequestable: boolean;
  procedureUsable: boolean;
  branchVisible: boolean;
  pharmacyVisible: boolean;
  otVisible: boolean;
};

export const MASTER_CLINICAL_CATALOG_CATEGORIES: MasterCategorySeed[] = [
  { slug: "surgical-consumables", name: "Surgical Consumables", parentSlug: null, domainType: ClinicalItemDomain.SURGICAL_CONSUMABLE, sortOrder: 0, description: "Sutures, blades, gauze, drapes and other single-use surgical supplies", isEssential: true, inventoryTracked: true, packageEligible: true, prescriptionEligible: false, supplyRequestable: true, procedureUsable: true, branchVisible: true, pharmacyVisible: false, otVisible: true },
  { slug: "medical-consumables", name: "Medical Consumables", parentSlug: null, domainType: ClinicalItemDomain.CLINIC_SUPPLY, sortOrder: 1, description: "General medical and examination consumables", isEssential: true, inventoryTracked: true, packageEligible: true, prescriptionEligible: false, supplyRequestable: true, procedureUsable: true, branchVisible: true, pharmacyVisible: true, otVisible: true },
  { slug: "medications", name: "Medications", parentSlug: null, domainType: ClinicalItemDomain.MEDICINE, sortOrder: 2, description: "Pharmacy and injectable medicines", isEssential: true, inventoryTracked: true, packageEligible: true, prescriptionEligible: true, supplyRequestable: true, procedureUsable: true, branchVisible: true, pharmacyVisible: true, otVisible: true },
  { slug: "vaccines", name: "Vaccines", parentSlug: null, domainType: ClinicalItemDomain.MEDICINE, sortOrder: 3, description: "Vaccination and immunization", isEssential: true, inventoryTracked: true, packageEligible: true, prescriptionEligible: false, supplyRequestable: true, procedureUsable: true, branchVisible: true, pharmacyVisible: true, otVisible: false },
  { slug: "diagnostic-supplies", name: "Diagnostic Supplies", parentSlug: null, domainType: ClinicalItemDomain.CLINIC_SUPPLY, sortOrder: 4, description: "Tests, reagents and diagnostic consumables", isEssential: true, inventoryTracked: true, packageEligible: true, prescriptionEligible: false, supplyRequestable: true, procedureUsable: true, branchVisible: true, pharmacyVisible: false, otVisible: true },
  { slug: "laboratory", name: "Laboratory Materials", parentSlug: null, domainType: ClinicalItemDomain.CLINIC_SUPPLY, sortOrder: 5, description: "Lab consumables and sample handling", isEssential: true, inventoryTracked: true, packageEligible: true, prescriptionEligible: false, supplyRequestable: true, procedureUsable: true, branchVisible: true, pharmacyVisible: false, otVisible: true },
  { slug: "surgical-instruments", name: "Surgical Instruments", parentSlug: null, domainType: ClinicalItemDomain.INSTRUMENT, sortOrder: 6, description: "Reusable surgical instruments", isEssential: true, inventoryTracked: true, packageEligible: true, prescriptionEligible: false, supplyRequestable: true, procedureUsable: true, branchVisible: true, pharmacyVisible: false, otVisible: true },
  { slug: "dental-supplies", name: "Dental Supplies", parentSlug: null, domainType: ClinicalItemDomain.CLINIC_SUPPLY, sortOrder: 7, description: "Dental consumables and small equipment", isEssential: false, inventoryTracked: true, packageEligible: true, prescriptionEligible: false, supplyRequestable: true, procedureUsable: true, branchVisible: true, pharmacyVisible: false, otVisible: true },
  { slug: "anesthesia-supplies", name: "Anesthesia Supplies", parentSlug: null, domainType: ClinicalItemDomain.CLINIC_SUPPLY, sortOrder: 8, description: "ET tubes, masks, anesthetic consumables", isEssential: true, inventoryTracked: true, packageEligible: true, prescriptionEligible: false, supplyRequestable: true, procedureUsable: true, branchVisible: true, pharmacyVisible: false, otVisible: true },
  { slug: "emergency-supplies", name: "Emergency Supplies", parentSlug: null, domainType: ClinicalItemDomain.CLINIC_SUPPLY, sortOrder: 9, description: "Emergency and crash cart items", isEssential: true, inventoryTracked: true, packageEligible: true, prescriptionEligible: false, supplyRequestable: true, procedureUsable: true, branchVisible: true, pharmacyVisible: true, otVisible: true },
  { slug: "wound-care", name: "Wound Care", parentSlug: null, domainType: ClinicalItemDomain.DRESSING_SUPPLY, sortOrder: 10, description: "Dressings, bandages and wound care", isEssential: true, inventoryTracked: true, packageEligible: true, prescriptionEligible: false, supplyRequestable: true, procedureUsable: true, branchVisible: true, pharmacyVisible: true, otVisible: true },
  { slug: "iv-catheter-supplies", name: "Catheter / IV Supplies", parentSlug: null, domainType: ClinicalItemDomain.CLINIC_SUPPLY, sortOrder: 11, description: "IV sets, cannulas, catheters", isEssential: true, inventoryTracked: true, packageEligible: true, prescriptionEligible: false, supplyRequestable: true, procedureUsable: true, branchVisible: true, pharmacyVisible: false, otVisible: true },
  { slug: "sterilization-cssd", name: "Sterilization & CSSD Supplies", parentSlug: null, domainType: ClinicalItemDomain.CLINIC_SUPPLY, sortOrder: 12, description: "Sterilization consumables and packaging", isEssential: true, inventoryTracked: true, packageEligible: false, prescriptionEligible: false, supplyRequestable: true, procedureUsable: false, branchVisible: true, pharmacyVisible: false, otVisible: true },
  { slug: "ppe-safety", name: "PPE & Safety", parentSlug: null, domainType: ClinicalItemDomain.CLINIC_SUPPLY, sortOrder: 13, description: "Gloves, masks, aprons, safety equipment", isEssential: true, inventoryTracked: true, packageEligible: true, prescriptionEligible: false, supplyRequestable: true, procedureUsable: true, branchVisible: true, pharmacyVisible: true, otVisible: true },
  { slug: "sample-collection", name: "Sample Collection Materials", parentSlug: null, domainType: ClinicalItemDomain.CLINIC_SUPPLY, sortOrder: 14, description: "Tubes, swabs, containers for samples", isEssential: true, inventoryTracked: true, packageEligible: true, prescriptionEligible: false, supplyRequestable: true, procedureUsable: true, branchVisible: true, pharmacyVisible: false, otVisible: true },
  { slug: "disposal-biomedical", name: "Disposal / Biomedical Waste", parentSlug: null, domainType: ClinicalItemDomain.CLINIC_SUPPLY, sortOrder: 15, description: "Sharps containers, biohazard bags", isEssential: true, inventoryTracked: true, packageEligible: false, prescriptionEligible: false, supplyRequestable: true, procedureUsable: false, branchVisible: true, pharmacyVisible: true, otVisible: true },
  { slug: "packaging-dispensing", name: "Packaging / Dispensing Materials", parentSlug: null, domainType: ClinicalItemDomain.CLINIC_SUPPLY, sortOrder: 16, description: "Medicine pouches, labels, dispensing", isEssential: true, inventoryTracked: true, packageEligible: false, prescriptionEligible: false, supplyRequestable: true, procedureUsable: false, branchVisible: true, pharmacyVisible: true, otVisible: false },
  { slug: "misc-clinical", name: "Misc Clinical Accessories", parentSlug: null, domainType: ClinicalItemDomain.CLINIC_SUPPLY, sortOrder: 17, description: "Other clinical supplies", isEssential: false, inventoryTracked: true, packageEligible: true, prescriptionEligible: false, supplyRequestable: true, procedureUsable: true, branchVisible: true, pharmacyVisible: true, otVisible: true },
];
