# 🎯 BPA Context Pack
## Complete AI Assistant Guide for Bangladesh Pet Association (BPA)

> **Purpose:** This document provides comprehensive context to AI assistants (Cursor AI, GitHub Copilot, etc.) to work on BPA system professionally, maintaining standards, and delivering scalable solutions.

---

## 📋 Table of Contents

1. [Project Identity & Scope](#1-project-identity--scope)
2. [Never Change Rules (Hard Constraints)](#2-never-change-rules-hard-constraints)
3. [Architecture & Tech Stack](#3-architecture--tech-stack)
4. [Domain Model (Business Entities)](#4-domain-model-business-entities)
5. [RBAC (Role-Based Access Control)](#5-rbac-role-based-access-control)
6. [API Routes](#6-api-routes)
7. [Development Workflow](#7-development-workflow)
8. [Master Prompt for AI](#8-master-prompt-for-ai)
9. [Change Management Policy](#9-change-management-policy)

---

## 1. Project Identity & Scope

### A) Project Identity

* **Project Name:** Bangladesh Pet Association (BPA)
* **Goal:** Multi-tenant ecosystem connecting:
  * 🏥 Pet Clinics
  * 🛍️ Pet Shops
  * 🚚 Delivery Hubs
  * 📦 Online Marketplace
  * 💳 Membership/Ownership Cards
* **Target Market:** Bangladesh (Bilingual: English + Bengali)
* **Success Criteria:** Production-ready, scalable, secured, maintainable

### B) Project Scope

BPA is a **unified digital ecosystem** where:
- Pet parents can manage their pets, book appointments, shop online
- Clinics can manage patients, prescriptions, appointments
- Pet shops can manage inventory, POS, online orders
- Delivery hubs can manage shipments and logistics
- All services are integrated under one platform

---

## 2. Never Change Rules (Hard Constraints)

### ⚠️ CRITICAL: These rules MUST NEVER be violated

#### A) Port Configuration (FIXED - DO NOT CHANGE)

* **API Port:** `3000` (reserved, must never change)
* **Next.js Ports (Fixed):**
  * `mother` = `3100`
  * `shop` = `3101`
  * `clinic` = `3102`
  * `admin` = `3103`
  * `owner` = `3104`
* **Rule:** Do not modify port assignments or CORS origins

#### B) API Structure

* **API Prefix:** `/api/v1` (must never change)
* **Authentication:** Cookie-based (credentials include)
* **Versioning:** v1 (stable)

#### C) Database

* **ORM:** Prisma (mandatory)
* **Database:** PostgreSQL
* **Migrations:** Must be safe and migration-aware
* **Schema Changes:** Must not break existing data

#### D) Code Change Policy

* **Never delete existing working code**
* **Always merge changes** - preserve old code when updating
* **Prefer smallest possible patch** - minimal changes
* **Update-only patches** - only changed/new files in deliverables

#### E) Deliverable Format

Every change must include:
* `PATCH_NOTES.md` - What changed and why
* `CHANGED_FILES.txt` - List of modified/new files
* `APPLY_INSTRUCTIONS.md` - Step-by-step apply guide
* **Patch ZIP** - Only changed/new files (not full codebase)

#### F) Breaking Changes Policy

* **If breaking change needed:**
  1. Stop and create `CHANGE_PROPOSAL.md`
  2. Explain: Why needed, what breaks, migration steps, rollback plan
  3. Wait for approval before implementing

---

## 3. Architecture & Tech Stack

### A) Backend

* **Runtime:** Node.js + Express
* **ORM:** Prisma
* **Database:** PostgreSQL
* **Storage:** MinIO (Media & Documents)
* **API Prefix:** `/api/v1`
* **Authentication:** Cookie-based (credentials include)
* **Port:** `3000` (fixed)

### B) Frontend (Referenced)

* **Framework:** Next.js (App Router)
* **Multi-App Routes:**
  * `/mother` - Public landing + auth
  * `/shop` - Pet shop dashboard
  * `/clinic` - Clinic dashboard
  * `/admin` - Admin dashboard
  * `/owner` - Owner dashboard
* **Mobile:** Flutter (Android & iOS)
* **State Management (Flutter):** Riverpod

### C) Infrastructure

* **Containerization:** Docker & Docker Compose
* **Orchestration:** Docker Compose for local development
* **Versioning:** Semantic versioning (MAJOR.MINOR.PATCH)

### D) Development Environment

* **API Base URL:** `http://localhost:3000/api/v1`
* **CORS:** Configured for Next.js apps (ports 3100-3104)
* **Environment Variables:** `.env` files (see `.env.example`)

---

## 4. Domain Model (Business Entities)

### Core Entities

#### A) Organization & Branch

* **Organization:**
  * Multi-tenant entity
  * Can have multiple branches
  * Owner manages organization
* **Branch:**
  * Type: Clinic / Shop / Hub
  * Location-based (Division, District, Upazila, Area)
  * Status: Draft → Submitted → Approved → Active
  * Verification: Location + Photos required

#### B) User & Authentication

* **User:**
  * Profile, Contact, Status
  * Auth: Email/Phone + Password
  * Invite-based registration for staff
* **UserAuth:**
  * Credentials, OTP, Email verification
  * Cookie-based sessions

#### C) Staff & Roles

* **Staff:**
  * Assigned to Organization/Branch
  * Role-based permissions
  * Invitation system
* **Roles:**
  * SUPER_ADMIN, ORG_OWNER, BRANCH_MANAGER, SELLER, STAFF, VET, CLINIC_ASSISTANT, DELIVERY_MANAGER, DELIVERY_STAFF

#### D) Products & Inventory

* **Products:**
  * CRUD operations
  * Variants (Size, Flavor, etc.)
  * Stock per branch
  * Expiry tracking
* **Inventory:**
  * Central + Branch stock
  * Auto stock deduction on sale
  * Stock alerts (low stock, expiring items)

#### E) Services (Clinic)

* **Services:**
  * Consultation, Vaccine, Grooming, etc.
  * Price per branch
  * Staff assignment (Vet)

#### F) Orders

* **Online Orders:**
  * Customer → Shop/Clinic
  * Status flow: Pending → Confirmed → Processing → Shipped → Delivered
* **POS Orders:**
  * Offline sales at branch
  * Real-time stock update

#### G) Delivery

* **Delivery Hub:**
  * Consolidation point
  * Packaging management
* **Delivery Staff:**
  * Rider assignment
  * Status tracking
  * Cost tracking (future)

#### H) Ownership Card

* **Membership Card:**
  * Premium subscription
  * Discount rules
  * Eligibility criteria
  * Usage logs

#### I) Reports

* **Stock Reports:**
  * Aging analysis
  * Top sellers
  * Zero sales (last 3 months)
  * Expiring items
* **Sales Reports:**
  * Summary by branch
  * Revenue tracking
  * Customer analytics

---

## 5. RBAC (Role-Based Access Control)

### A) Roles

| Role | Description | Scope |
|------|-------------|-------|
| **SUPER_ADMIN** | Platform administrator | Full system access |
| **ORG_OWNER** | Organization owner | Own organization + branches |
| **BRANCH_MANAGER** | Branch manager | Single branch management |
| **SELLER** | Sales staff | POS, orders, inventory view |
| **STAFF** | General staff | Limited access |
| **VET** | Veterinarian | Clinical services, prescriptions |
| **CLINIC_ASSISTANT** | Clinic helper | Appointment management |
| **DELIVERY_MANAGER** | Delivery hub manager | Hub operations |
| **DELIVERY_STAFF** | Delivery rider | Order delivery |

### B) Permission Naming Convention

Format: `{resource}.{action}`

Examples:
* `branch.read` - View branches
* `branch.create` - Create branch
* `branch.update` - Update branch
* `product.create` - Create product
* `product.update` - Update product
* `order.view` - View orders
* `inventory.update` - Update inventory
* `report.view` - View reports
* `staff.manage` - Manage staff
* `org.read` - View organization
* `settings.read` - View settings
* `settings.manage` - Manage settings

### C) Permission Rules

* **Backend:** Middleware checks permissions (`src/middleware/auth.middleware.ts`)
* **Frontend:** Menu visibility based on permissions
* **Single Source:** Permission keys must match between backend and frontend
* **API Endpoints:** Must check permissions before allowing access

### D) Permission Matrix Example

| Role | branch.read | branch.create | product.create | order.view | staff.manage |
|------|------------|---------------|----------------|------------|--------------|
| ORG_OWNER | ✅ | ✅ | ✅ | ✅ | ✅ |
| BRANCH_MANAGER | ✅ (own) | ❌ | ✅ | ✅ | ❌ |
| SELLER | ✅ (own) | ❌ | ❌ | ✅ | ❌ |
| STAFF | ✅ (own) | ❌ | ❌ | ✅ | ❌ |

---

## 6. API Routes

### Base URL: `http://localhost:3000/api/v1`

### A) Authentication

* `POST /auth/login` - Login
* `POST /auth/logout` - Logout
* `GET /auth/me` - Current user

### B) Owner Endpoints

* `GET /owner/organizations` - List organizations
* `POST /owner/organizations` - Create organization
* `GET /owner/organizations/:id` - Get organization
* `PATCH /owner/organizations/:id` - Update organization
* `GET /owner/branches` - List branches
* `POST /owner/branches` - Create branch
* `GET /owner/branches/:id` - Get branch
* `PATCH /owner/branches/:id` - Update branch
* `GET /owner/staffs` - List staff
* `POST /owner/staffs` - Create/invite staff
* `PATCH /owner/staffs/:id` - Update staff
* `PATCH /owner/staffs/:id/disable` - Disable staff
* `DELETE /owner/staffs/:id` - Delete staff

### C) Admin Endpoints

* `GET /admin/organizations` - List all organizations
* `GET /admin/branches` - List all branches
* `GET /admin/users` - List users
* `GET /admin/staff` - List staff
* `GET /admin/roles` - List roles
* `GET /admin/permissions` - List permissions
* `GET /admin/verifications/owners` - Owner verifications
* `GET /admin/verifications/branches` - Branch verifications
* `POST /admin/verifications/owners/:id/approve` - Approve owner
* `POST /admin/verifications/branches/:id/approve` - Approve branch

### D) Location Endpoints

* `GET /locations/divisions?lang={en|bn}` - Get divisions
* `GET /locations/districts?divisionId={id}&lang={en|bn}` - Get districts
* `GET /locations/upazilas?districtId={id}&lang={en|bn}` - Get upazilas
* `GET /locations/bd-areas?upazilaId={id}&lang={en|bn}` - Get areas

### E) Common Patterns

* **List:** `GET /{resource}` - Returns paginated list
* **Get:** `GET /{resource}/:id` - Returns single item
* **Create:** `POST /{resource}` - Creates new item
* **Update:** `PATCH /{resource}/:id` - Updates item
* **Delete:** `DELETE /{resource}/:id` - Deletes item

---

## 7. Development Workflow

### A) Task Breakdown (PHASE-wise)

1. **Audit Phase (Read-Only)**
   * Analyze codebase structure
   * Identify broken routes (404)
   * Check Prisma schema mismatches
   * Find API endpoint issues
   * Output: `AUDIT_REPORT.md` (no code changes)

2. **Fix Phase (Update-Only)**
   * Fix broken endpoints
   * Fix permission/middleware issues
   * Fix Prisma errors
   * Fix CORS issues
   * Output: Update-only patch ZIP

3. **Feature Phase (Additive)**
   * Add new endpoints
   * Extend existing modules
   * Add new business logic
   * Output: Feature patch ZIP

4. **QA Phase**
   * Test steps
   * Verification commands
   * Rollback instructions (if needed)

### B) Change Documentation

Every change must include:

#### PATCH_NOTES.md
```markdown
# Patch Notes vX.Y.Z

## Changes
- Fixed: [What was fixed]
- Added: [What was added]
- Updated: [What was updated]

## Affected Files
- [List of files]

## Migration Steps
1. [Step 1]
2. [Step 2]

## Testing
- [Test case 1]
- [Test case 2]
```

#### CHANGED_FILES.txt
```
src/api/v1/modules/owner/owner.controller.ts
src/api/v1/modules/owner/owner.routes.ts
prisma/schema.prisma
```

#### APPLY_INSTRUCTIONS.md
```markdown
# Apply Instructions

1. Backup current codebase
2. Extract patch ZIP
3. Copy files to respective locations
4. Run: npm install (if package.json changed)
5. Run: npx prisma migrate dev (if schema changed)
6. Run: npx prisma generate
7. Restart API server
8. Verify changes
```

### C) Code Quality Rules

* **Never delete working code** - Always merge
* **Backward compatibility** - Existing endpoints must work
* **Semantic versioning** - MAJOR.MINOR.PATCH
* **Update-only patches** - Only changed files
* **Test before deliver** - Verify changes work
* **Prisma migrations** - Must be safe and reversible

---

## 8. Master Prompt for AI

### Copy this prompt when starting work on BPA:

```
You are working on the BPA (Bangladesh Pet Association) backend API.

HARD CONSTRAINTS (never violate):
- API runs on port 3000 only.
- API prefix /api/v1 must never change.
- Authentication: cookie-based (credentials include).
- Never delete or overwrite old code blindly. Always merge changes so existing features remain.
- Deliverables must be "update-only patch zip" (only changed files) + 
  APPLY_INSTRUCTIONS.md + PATCH_NOTES.md + CHANGED_FILES.txt.
- If any breaking change is required, stop and write CHANGE_PROPOSAL.md explaining why, impact, and alternatives.

TECH STACK:
- Node.js + Express
- Prisma ORM + PostgreSQL
- MinIO for storage
- Docker compose

RBAC:
- Roles: SUPER_ADMIN, ORG_OWNER, BRANCH_MANAGER, SELLER, STAFF, VET, CLINIC_ASSISTANT, DELIVERY_MANAGER, DELIVERY_STAFF
- Permissions: branch.read, product.create, product.update, order.view, inventory.update, report.view, staff.manage etc.
- Middleware: src/middleware/auth.middleware.ts checks permissions.
- Permission keys must match frontend (src/lib/permissionMenu.ts in Next.js app).

TASK MODE:
1. First produce AUDIT_REPORT.md (read-only) describing:
   - API endpoints, broken routes
   - prisma schema mismatches
   - middleware/permission issues
   - CORS configuration
2. Then produce update-only patch implementing highest priority fixes without breaking existing features.
3. Provide exact apply steps and verification commands.

PRIORITY:
- Fix broken API endpoints (404, 500 errors)
- Fix Prisma select/unknown fields errors
- Fix permission middleware issues
- Ensure CORS allows Next.js apps (ports 3100-3104)
```

---

## 9. Change Management Policy

### A) Breaking Changes

If any of these need to change:
- Port number (3000)
- API route structure (`/api/v1` prefix)
- Database schema (Prisma models)
- Authentication method
- Permission key names
- API endpoint paths (existing endpoints)

**Process:**
1. **STOP** - Do not implement
2. Create `CHANGE_PROPOSAL.md` with:
   - Why change is needed
   - What will break
   - Migration steps
   - Rollback plan
   - Alternatives considered
3. Wait for approval
4. Then implement with full documentation

### B) Safe Changes (Can proceed)

- Adding new endpoints
- Adding new features
- Bug fixes (non-breaking)
- Performance optimizations
- Documentation updates
- Adding new Prisma models (non-breaking)

### C) Change Approval Checklist

Before implementing any change, verify:
- [ ] Does it violate any "Never Change" rules?
- [ ] Will it break existing functionality?
- [ ] Is it backward compatible?
- [ ] Are migration steps documented?
- [ ] Is rollback plan available?
- [ ] Are test steps included?
- [ ] Are Prisma migrations safe?

---

## 📚 Related Documents

* [PROJECT_CONTEXT.md](./PROJECT_CONTEXT.md) - Technical context
* [BPA_PROJECT_DOCUMENTATION.md](./BPA_PROJECT_DOCUMENTATION.md) - Project overview
* [DECISIONS_LOG.md](./DECISIONS_LOG.md) - Architecture decisions

---

## 🎯 Quick Reference

### Ports
- API: `3000` (fixed)

### Key Files
- Prisma Schema: `prisma/schema.prisma`
- Auth Middleware: `src/middleware/auth.middleware.ts`
- API Routes: `src/api/v1/modules/*/`
- Controllers: `src/api/v1/modules/*/*.controller.ts`

### Common Commands
```bash
# Prisma
npx prisma migrate dev
npx prisma generate
npx prisma studio

# API Server
npm run dev        # Development
npm run build      # Build
npm start          # Production
```

---

*Last Updated: January 2026*
*Version: 1.0.0*
*For AI Assistants: Use this document as your primary context when working on BPA backend API.*
