# BPA Database Recovery Report

**Date:** 2026-06-05  
**Host:** Windows 10, PostgreSQL 18 (`postgresql-x64-18` service)  
**Port:** 5432 (local install — Docker not in PATH on this machine)

---

## Executive summary

The backend was temporarily pointed at a **non-existent database** (`bpa_dev`) with **invalid credentials** (`postgres` / `postgres`). The only BPA database on this machine is **`bpa_pet_db`**, which contains the full Prisma schema (487 tables, 271 migrations) and real development data including users, organizations, campaign bookings, and orders.

**Action taken:** `.env` updated to reconnect using the credentials from the last known working configuration (backup `.env` + `docker-compose.yml`).

**Confidence:** **Very high (95%+)** — single candidate with BPA data; migrations applied through today; matches all historical config references.

---

## 1. Configuration discovery

### Sources searched

| Source | Path | DATABASE_URL found |
|--------|------|-------------------|
| Current `.env` (before fix) | `backend-api/.env` | `postgres@localhost:5432/bpa_dev` ❌ (DB does not exist) |
| Current `.env` (partial fix) | `backend-api/.env` | `postgres@localhost:5432/bpa_pet_db` ❌ (wrong password) |
| **Backup `.env` (last known good)** | `Projects Version/backend-api_backup_before_recovery/.env` | `bpa_admin@localhost:5432/bpa_pet_db` ✅ |
| Backup `.env.docker` | same folder | `bpa_admin@bpa_db:5432/bpa_pet_db` |
| `docker-compose.yml` | `backend-api/docker-compose.yml` | `POSTGRES_USER=bpa_admin`, `POSTGRES_DB=bpa_pet_db` |
| Next.js app | `next_app/next_v0/.env` | `bpa_admin@localhost:5432/bpa_pet_db` |
| `.env.example` (current) | `backend-api/.env.example` | `bpa_onboarding` (template only) |
| Docs (debug report) | `docs/debug/campaign-booking-bookingMode-schema-report.md` | References `bpa_pet_db` |
| PM2 / `.env.production` / `.env.local` | — | **Not found** on this machine |

### Historical database names referenced in project (not all present locally)

| Name | Found on local PostgreSQL? |
|------|----------------------------|
| `bpa_pet_db` | **Yes — primary data** |
| `bpa_pet_db_shadow` | Yes (shadow) |
| `bpa_dev` | **No** |
| `bpa_onboarding` | **No** |
| `bpa_onboarding_shadow` | **No** |
| `bpa_production` | No (production docs only) |
| `pranidoctor_db` | Yes (unrelated project) |

---

## 2. PostgreSQL audit

### Server

- **Engine:** PostgreSQL 18 (Windows service)
- **Host:** `localhost:5432`
- **Docker:** Not available in shell PATH (data lives on native PostgreSQL 18, likely migrated from earlier Docker volume or parallel install)

### Login roles

| Role | Can login |
|------|-----------|
| `bpa_admin` | Yes |
| `postgres` | Yes (password ≠ `postgres` on this install) |

### All databases

| Database | Purpose |
|----------|---------|
| `bpa_pet_db` | **BPA application data** |
| `bpa_pet_db_shadow` | Prisma shadow DB |
| `postgres` | System default |
| `pranidoctor_db` | Non-BPA |

---

## 3. Candidate verification — `bpa_pet_db`

| Check | Result |
|-------|--------|
| Connect with `bpa_admin` | ✅ |
| Public tables | **487** |
| `_prisma_migrations` rows | **271** |
| Latest migration | `20260605160000_payment_transactions` (2026-06-05 08:29 UTC) |
| `npm run prisma:migrate:status` | **Database schema is up to date** |

### Record counts

| Table | Count | Notes |
|-------|------:|-------|
| `users` | 4 | Active accounts |
| `user_auth` | 4 | Email/phone login rows |
| `user_profiles` | 4 | Display names / usernames |
| `organizations` | 1 | "Bangladesh Pet Association" |
| `branches` | 1 | |
| `pets` | 0 | |
| `products` | 0 | |
| `campaigns` | 2 | Vaccination campaigns |
| `campaign_bookings` | 3 | |
| `orders` | 13 | |
| `staff_invites` | 0 | |

### Registered login identities (for auth troubleshooting)

| User ID | Email | Phone | Profile |
|--------:|-------|-------|---------|
| 1 | balagpetcare@gmail.com | — | balagpetcare |
| 2 | balag@bangladeshpetassociation.com | 01777889994 | Bala G 74 |
| 3 | admin@bangladeshpetassociation.com | 01701022274 | BPA Super Admin |
| 4 | balag.bd@gmail.com | — | Bala G |

> Passwords are stored as bcrypt hashes in `user_auth.passwordHash`. Login success/failure depends on the password used at account creation (`SUPER_ADMIN_PASSWORD` from seed/bootstrap, or passwords set via the app) — not on `DATABASE_URL` once connected.

### Other candidates

| Database | Verdict |
|----------|---------|
| `bpa_dev` | Does not exist |
| `bpa_onboarding` | Does not exist |
| `bpa_pet_db_shadow` | Shadow only — no app data |
| `pranidoctor_db` | Not audited — name indicates different product |

---

## 4. Best match determination

| Candidate | Score | Reasoning |
|-----------|------:|-----------|
| **`bpa_pet_db`** | **Winner** | Only DB with BPA schema + data; 271 migrations; latest migration today; matches backup `.env`, docker-compose, and next_app config |
| `bpa_dev` | Eliminated | Database does not exist on server |
| `bpa_onboarding` | Eliminated | Not present locally (template-only name in `.env.example`) |

---

## 5. Environment recovery (applied)

Updated `backend-api/.env`:

```env
DATABASE_URL=postgresql://bpa_admin:***@localhost:5432/bpa_pet_db?schema=public
SHADOW_DATABASE_URL=postgresql://bpa_admin:***@localhost:5432/bpa_pet_db_shadow?schema=public
```

*(Password masked in this report — see local `.env`.)*

**Previous incorrect values:**
- `postgres:postgres@…/bpa_dev` — database missing, auth failed
- `postgres:postgres@…/bpa_pet_db` — wrong user/password for this PostgreSQL instance
- Shadow DB typo `bpa_pets_shadow` — corrected to `bpa_pet_db_shadow`

---

## 6. Validation results

| Command | Result |
|---------|--------|
| `npm run prisma:generate` | ✅ Prisma Client generated (v7.7.0) |
| `npm run prisma:migrate:status` | ✅ 271 migrations; **schema up to date** |
| `npm run validate:env` | ✅ Passed (storage warnings only — unrelated) |

**No destructive operations performed:** no `migrate reset`, no `db push`, no drops, no truncates.

---

## 7. Auth note

After reconnecting, authentication depends on **correct email/phone + password** for the four users above. If login still fails:

1. Confirm you are hitting the API using this `.env` (restart `npm run dev` after `.env` change).
2. Use known super-admin phones from whitelist: `017777889994`, `01701022274` (note user 2 has `01777889994` — verify typo vs whitelist).
3. Re-run bootstrap only if you intend to reset passwords: `npm run admin:bootstrap` (uses `SUPER_ADMIN_PASSWORD` from `.env`).

---

## 8. Utility scripts (read-only audit)

Created for this recovery (safe to re-run):

| Script | Purpose |
|--------|---------|
| `scripts/_audit-databases.mjs` | List all DBs and score BPA candidates |
| `scripts/_verify-bpa-pet-db.mjs` | Table counts + migration snapshot |
| `scripts/_list-auth-tables.mjs` | Dump `user_auth` / `user_profiles` |

---

## 9. Recommended next steps

1. **Restart API:** `npm run dev` so Prisma picks up the new `DATABASE_URL`.
2. **Test login** with a known account from the table above.
3. **Optional:** Copy backup storage/Redis sections from `Projects Version/backend-api_backup_before_recovery/.env` if MinIO endpoints differ.
4. **Do not** create `bpa_dev` or `bpa_onboarding` unless you explicitly want a fresh empty database.

---

## Status

| Item | Status |
|------|--------|
| BPA data preserved | ✅ |
| Correct database selected | ✅ `bpa_pet_db` |
| `.env` updated | ✅ |
| Prisma connected | ✅ |
| Migrations in sync | ✅ |

**Recovery complete.**
