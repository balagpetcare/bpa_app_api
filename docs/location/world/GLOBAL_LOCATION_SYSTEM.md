# 🌍 Global Location System (Seeders + Integration)
## Cursor AI – Master Instruction File

---

## 🎯 Objective

Create a **unified, production-ready global location system** for the platform
using **database seeders** and **shared location logic**.

This system must support the following countries from day one:

- 🇧🇩 Bangladesh
- 🇮🇳 India
- 🇱🇰 Sri Lanka
- 🇲🇾 Malaysia
- 🇸🇬 Singapore

The location system must be reusable, consistent, and safe to use across
**all existing and future modules**.

---

## 🧠 Core Principles (DO NOT VIOLATE)

1. ❌ Do NOT delete or overwrite existing code
2. ✅ Always MERGE with existing logic
3. ✅ Seeder must be re-runnable (idempotent)
4. ✅ Use transactions where possible
5. ❌ No hardcoded location strings in forms
6. ✅ One global source of truth for locations

---

## 🏗 Existing System Constraints

- Backend: Node.js + Express
- Database: PostgreSQL
- ORM: Prisma (if present)
- API Port: **3000 (MUST NOT CHANGE)**
- Next.js fixed ports:
  - mother: 3100
  - shop: 3101
  - clinic: 3102
  - admin: 3103
  - owner: 3104

All existing endpoints, schemas, and routes must continue working.

---

## 🗄️ Database Design Requirements

Implement or extend the following tables
(**do NOT duplicate if already exists**):

### 1. countries
- id (PK)
- name
- iso_code (ISO-2 or ISO-3)
- phone_code
- latitude
- longitude
- created_at

### 2. states / divisions / provinces
- id (PK)
- country_id (FK)
- name
- code
- latitude
- longitude

### 3. cities / districts
- id (PK)
- state_id (FK)
- name
- latitude
- longitude

### 4. areas / sub-districts (where applicable)
- id (PK)
- city_id (FK)
- name
- latitude
- longitude

All tables must support:
- proper indexing
- unique constraints (to avoid duplicates)
- relational integrity

---

## 🌱 Seeder Requirements

### General Rules
- Use **official or trusted datasets**
- Avoid fake or placeholder locations
- Use **UPSERT / ON CONFLICT** logic
- Seeders must be **safe to run multiple times**

### Country-wise Expectations

#### Bangladesh
- Divisions
- Districts
- Upazilas (where available)

#### India
- States & Union Territories
- Major districts / cities

#### Sri Lanka
- Provinces
- Districts

#### Malaysia
- States
- Federal Territories
- Major cities

#### Singapore
- Country only
- Planning Areas / Regions (optional but preferred)

---

## 🧩 Seeder File Structure

Create seeders using a clear structure:

```
prisma/seeders/location/
  index.ts                 # runGlobalLocationSeed(prisma) – runs all below
  seedGlobalCountries.ts   # BD, IN, LK, MY, SG (phone_code, lat/lng)
  seedGlobalStates.ts      # Divisions / States / Provinces per country
  seedGlobalCities.ts      # Districts / major cities per state
  seedGlobalSubDistricts.ts # Upazilas / areas (e.g. BD from bd.upazilas.json)
```

**Execution order** (from main `prisma/seed.ts`): after `seedCountries`, run `runGlobalLocationSeed(prisma)` so that countries exist before states/cities/sub-districts.

**Database**: Extended `Country` (phoneCode, latitude, longitude), `State` (latitude, longitude). New models `LocationCity` (state → city/district), `LocationSubDistrict` (city → area/upazila). Existing BD seed-data (`bd.divisions.json`, `bd.districts.json`, `bd.upazilas.json`) is used where applicable; other countries use embedded trusted data.

