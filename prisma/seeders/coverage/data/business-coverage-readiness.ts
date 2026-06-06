import { CoverageZoneType } from '@prisma/client';

/** System readiness templates — no entity/business rows inserted. */
export const BUSINESS_COVERAGE_READINESS = [
  {
    name: 'Doctor Coverage',
    slug: 'doctor-coverage-readiness',
    description: 'Ready for LocationCoverageEntityType.DOCTOR assignments',
    zoneType: CoverageZoneType.BUSINESS_READINESS,
    sortOrder: 100,
  },
  {
    name: 'Clinic Coverage',
    slug: 'clinic-coverage-readiness',
    description: 'Ready for LocationCoverageEntityType.CLINIC assignments',
    zoneType: CoverageZoneType.BUSINESS_READINESS,
    sortOrder: 101,
  },
  {
    name: 'Volunteer Coverage',
    slug: 'volunteer-coverage-readiness',
    description: 'Ready for LocationCoverageEntityType.VOLUNTEER assignments',
    zoneType: CoverageZoneType.BUSINESS_READINESS,
    sortOrder: 102,
  },
  {
    name: 'Rescue Coverage',
    slug: 'rescue-coverage-readiness',
    description: 'Ready for LocationCoverageEntityType.RESCUE_TEAM assignments',
    zoneType: CoverageZoneType.BUSINESS_READINESS,
    sortOrder: 103,
  },
  {
    name: 'Vaccination Coverage',
    slug: 'vaccination-coverage-readiness',
    description: 'Ready for campaign rollout + coverage assignment integration',
    zoneType: CoverageZoneType.BUSINESS_READINESS,
    sortOrder: 104,
  },
  {
    name: 'Shop Delivery Coverage',
    slug: 'shop-delivery-coverage-readiness',
    description: 'Ready for LocationCoverageEntityType.SHOP delivery assignments',
    zoneType: CoverageZoneType.BUSINESS_READINESS,
    sortOrder: 105,
  },
] as const;
