# Full Profile System — Enterprise Plan

**Location:** `D:/BPA_Data/backend-api/docs/FULL_PROFILE_SYSTEM_ENTERPRISE_PLAN.md`
**Status:** Implemented (additive, non-breaking)
**Related rules:** `WINDSURF_GLOBAL_RULE.md`, `PRISMA_MIGRATION_NON_DESTRUCTIVE_POLICY.md`

---

## 1. Current-state audit (Phase 1)

### 1.1 Backend

| Area | Finding |
|------|---------|
| **Identity** | `User` is canonical; `UserAuth` holds email/phone/password; `UserProfile` holds display identity (displayName, username, bio, avatar/cover media). |
| **Owner vs user** | `OwnerProfile` and `OwnerKyc` hold owner/business KYC-grade data — separate from `UserProfile` by design. |
| **Staff / branch** | `BranchMember` + `BranchMemberRole` + `BranchAccessPermission` implement branch-scoped RBAC; `ClinicStaffProfile` holds per-branch professional/clinical extension (doctor fees, specialization tags, etc.). |
| **Doctor** | `DoctorVerification` + `DoctorLicense` + `ClinicStaffProfile` (staffType DOCTOR) cover professional and compliance data. |
| **Existing “me” APIs** | `GET /api/v1/auth/me` — rich session (panels, contexts, permissions, routing). `GET /api/v1/me` — minimal user + orgMembers + branchAccess. `GET/PATCH /api/v1/user/me` — social-style profile + auth email/phone updates **without** enterprise audit. |
| **Preferences** | `UserNotificationPrefs` exists (email/SMS/quiet hours). No first-class language/theme/timezone model before this work. |
| **Audit** | `AuditLog` with `AuditEntityType.USER` exists; `writeAudit` helper in `middlewares/auditWriter.ts`. |
| **Sessions** | `UserSession` stores refresh token hashes; suitable for **counts** and last activity placeholders, not full session management UI. |

### 1.2 Frontend

| Area | Finding |
|------|---------|
| **Session** | Panels use `GET /api/v1/auth/me` (`useMe`, layouts). |
| **Account UI** | Larkon `ProfileDropdown` links owner to `/owner/settings` for profile/settings; `TopProfileMenu` (legacy owner top bar) uses ad-hoc links. No unified “account hub” before this work. |
| **Design** | WowDash/Larkon components — new UI must reuse `LarkonDashboardShell`, cards, Bootstrap patterns. |

### 1.3 Gaps (before implementation)

- No single **enterprise** read model for profile + org + branch roles + professional summaries + preferences + security metadata.
- No **audited** self-service PATCH under `/api/v1/me/*` naming convention.
- No **UserAppSettings** for language/theme/timezone/dashboard landing / last active branch.
- **UserProfile** lacked optional personal fields (gender, DOB, address, emergency contact) for self-service where policy allows.

---

## 2. Target architecture

### 2.1 Principles

- **Backend is source of truth** for permissions; UI shows **capability summaries**, not raw RBAC editors.
- **Additive** endpoints under `/api/v1/me/*`; legacy `/api/v1/user/me` remains for backward compatibility.
- **User ≠ Staff** preserved: employment/clinical data is summarized from `BranchMember` / `ClinicStaffProfile`, not duplicated as a second identity.
- **Self-edit vs admin**: self can edit allowed profile + preferences; roles, branch assignment, verification status, compensation authority remain admin-managed.

### 2.2 Data model (additive)

- **`UserProfile`**: optional `gender`, `dateOfBirth`, `addressJson`, `emergencyContactJson`.
- **`UserNotificationPrefs`**: optional `allowInApp` (default true).
- **`UserAppSettings`** (1:1 `User`): `language`, `theme`, `timezone`, `dashboardLanding`, `lastActiveBranchId` (optional FK to `Branch`).

### 2.3 Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/v1/me/profile` | Full profile read model |
| PATCH | `/api/v1/me/profile` | Self-service allowed fields |
| GET | `/api/v1/me/settings` | App + notification preferences |
| PATCH | `/api/v1/me/settings` | Update preferences |
| GET | `/api/v1/me/security` | Last login, password timestamps, session count |
| POST | `/api/v1/me/security/password` | Change password (current + new) |
| GET | `/api/v1/me/capabilities` | Roles + permission keys + summaries |
| GET | `/api/v1/me/branches` | Branch memberships + roles |
| PATCH | `/api/v1/me/active-branch` | Persist last active branch (membership-checked) |
| GET | `/api/v1/me/audit` | Recent self-profile audit events (filtered) |

### 2.4 RBAC

- Authenticated users: **GET** own profile/settings/security/capabilities/branches/audit.
- **PATCH** allowed only for `User.status === ACTIVE` (blocked users: read-only or restricted per product policy — implemented as **no mutations** if not ACTIVE).
- Permissions are **not** edited via these routes.

### 2.5 Audit actions (examples)

- `PROFILE_UPDATED`
- `PROFILE_PHOTO_UPDATED` (when avatar media id changes)
- `USER_PREFERENCES_UPDATED`
- `USER_NOTIFICATION_PREFS_UPDATED`
- `ACTIVE_BRANCH_CHANGED`
- `PASSWORD_CHANGED`
- Legacy `PATCH /api/v1/user/me`: `PROFILE_UPDATED` (and photo variant when applicable)

---

## 3. Frontend route plan

| Panel | Primary hub |
|-------|-------------|
| Owner (Larkon) | `/owner/account` (tabs: overview, basic, professional, branches, preferences, notifications, security, audit) |
| Staff (Larkon) | `/staff/account` — same hub component, different nav base |
| Clinic (Larkon) | `/clinic/account` |
| Doctor (Larkon) | `/doctor/account` |

**Menu:** Profile dropdown updated to: Profile overview, My settings (preferences), My roles & branches, Security, Support (unchanged where present), Logout.

---

## 4. Rollout / compatibility

- No removal of `GET /api/v1/auth/me` or `GET /api/v1/user/me`.
- New consumers should prefer `/api/v1/me/profile` for structured enterprise data.
- Mobile can consume the same JSON contracts; optional fields degrade gracefully.

---

## 5. Remaining gaps / partial items

- **2FA / OTP**: structure only — no new OTP flow in this iteration (security section shows placeholders where applicable).
- **Full session list/revoke**: session **count** only unless extended later (no fake revoke buttons).
- **Email/phone change**: still allowed via existing profile update paths where policy permits; consider verification workflow in a future iteration.

---

**Updated:** `D:/BPA_Data/backend-api/docs/FULL_PROFILE_SYSTEM_ENTERPRISE_PLAN.md`
