# BPA Decisions Log

## Fixed Decisions
- API prefix: /api/v1
- Authentication: cookie-based
- Role system includes: Super Admin, Admin, Owner, Staff (Branch/Clinic/Shop roles as configured)
- Verification flow uses statuses like: SUBMITTED, REQUEST_CHANGES, VERIFIED, REJECTED, SUSPENDED
- WowDash is the base UI template for dashboards

## Non-negotiables
- Port structure must not change
- Existing routes must remain backward compatible
- Prisma schema changes must be safe and migration-aware
