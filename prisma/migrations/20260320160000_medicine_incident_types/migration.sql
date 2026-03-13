-- Add new medicine incident types for auto-detection (reconciliation, override, token, expired vial)
ALTER TYPE "MedicineIncidentType" ADD VALUE 'REPEATED_VIAL_MISMATCH';
ALTER TYPE "MedicineIncidentType" ADD VALUE 'FREQUENT_OVERRIDE';
ALTER TYPE "MedicineIncidentType" ADD VALUE 'TOKEN_UNUSED_INJECTIONS';
ALTER TYPE "MedicineIncidentType" ADD VALUE 'EXPIRED_VIAL_USE';
