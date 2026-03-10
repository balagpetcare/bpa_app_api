# Global Veterinary Doctor Verification

## Overview

The doctor verification system supports multi-country veterinary licensing: doctors choose a primary country, add one or more licenses (by regulatory body), and upload required documents. Admins can filter by country/body and use "Verify online" links to regulatory body portals.

## Backend

- **Reference data**: `VetCountry`, `VetRegulatoryBody`, `VetRequiredDocType` (seed: `prisma/seeders/seedVetRegulatoryBodies.ts`).
- **Verification**: `DoctorVerification` (legacy fields kept), `DoctorLicense` (one per country/body), `DoctorVerificationDocument` (optional `doctorLicenseId`).
- **Public API**: `GET /api/v1/vet-reference/countries`, `GET /api/v1/vet-reference/countries/:code/bodies`, `GET /api/v1/vet-reference/bodies/:id/doc-types`, `GET /api/v1/vet-reference/bodies/:id`.
- **Doctor API**: `GET/PUT /api/v1/doctor/verification`, `POST/DELETE /api/v1/doctor/verification/documents`, `POST/PUT/DELETE /api/v1/doctor/verification/licenses`, `POST /api/v1/doctor/verification/licenses/:id/documents`, `POST /api/v1/doctor/verification/submit`.
- **Admin**: `GET /api/v1/admin/verifications/doctors?status=&country=&bodyId=&limit=&offset=`; detail includes `licenses` with `regulatoryBody.verificationUrl`.

## Seed and migration

1. **Prisma**: Migrations are under `prisma/migrations/`. Apply with `npx prisma migrate deploy`. Regenerate client: `npx prisma generate`.
2. **Vet reference**: Run full seed to populate countries and regulatory bodies: `npm run seed` (includes `seedVetRegulatoryBodies`).
3. **Legacy data**: To create `DoctorLicense` from existing `licenseNumber` + `registrationBody`, run once:
   ```bash
   npx ts-node --compiler-options '{"module":"CommonJS"}' prisma/scripts/migrateDoctorVerificationToLicenses.ts
   ```

## Frontend

- **Doctor**: `/doctor/verification` – primary country, add licenses by regulatory body, upload documents at verification or per-license level; legacy license/registration fields still supported.
- **Admin**: Verification Inbox → Doctor tab – filters: Status, Country (code), Regulatory body; detail drawer: Overview (with licenses + Verify online), Licenses tab (per-license docs), Documents, Activity.
