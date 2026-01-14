# BPA Partner Onboarding API (Code-Ready)

This project implements the full flow:

**register → apply → create org → create branch (draft) → publish request → admin approve/reject → unlock modules (feature flags)**

## 1) Setup

1. Copy env:
   - `cp .env.example .env`
2. Install deps:
   - `npm install`
3. Prisma generate + migrate:
   - `npm run prisma:generate`
   - `npm run prisma:migrate`
4. Seed (roles/permissions + super admin):
   - `npm run db:seed`
5. Start dev server:
   - `npm run dev`

Server: `http://localhost:8080`
Health: `GET /health`

## 2) Login + Admin

- Seed creates a SUPER_ADMIN user from:
  - `SUPER_ADMIN_PHONE`
  - `SUPER_ADMIN_PASSWORD`

Use:
- `POST /api/v1/auth/login`

## 3) Main Endpoints

### Auth
- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `GET /api/v1/auth/me`

### Partner
- `POST /api/v1/partner/applications` (submit)
- `GET /api/v1/partner/applications/me`
- `POST /api/v1/partner/organizations` (requires partner approved)
- `GET /api/v1/partner/organizations`
- `POST /api/v1/partner/organizations/:orgId/branches` (creates **DRAFT**)
- `PATCH /api/v1/partner/branches/:branchId`
- `POST /api/v1/partner/branches/:branchId/publish` (DRAFT → **PENDING_REVIEW**)
- `GET /api/v1/partner/branches/:branchId/publish`

### Admin (platform)
> Requires platform role (SUPER_ADMIN / BPA_ADMIN) + permissions.

- `GET /api/v1/admin/partner/applications?status=PENDING_REVIEW`
- `POST /api/v1/admin/partner/applications/:id/approve`
- `POST /api/v1/admin/partner/applications/:id/reject`
- `GET /api/v1/admin/branches/publish-requests?status=PENDING`
- `POST /api/v1/admin/branches/publish-requests/:id/approve` (sets branch **ACTIVE** + featuresJson)
- `POST /api/v1/admin/branches/publish-requests/:id/reject`

## 4) Feature Flags / Module Locking

Each branch has:
- `capabilitiesJson`: `{ shop, clinic, delivery, onlineSellingEligible }`
- `featuresJson`: `{ posEnabled, ecommerceEnabled, appointmentsEnabled, walletPayoutsEnabled, inventoryEnabled, courierOpsEnabled }`

Admin approval sets `Branch.status = ACTIVE` and merges provided feature flags into `featuresJson`.

## 5) Notes

- This is a focused foundation. You can plug it into your existing BPA Node.js API by:
  - copying Prisma models/enums
  - copying route files and middleware
  - mapping to your `/api/v1/admin` structure

