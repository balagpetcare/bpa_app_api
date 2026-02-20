# Owners Team Management Automation

## Overview

Automation for syncing users & roles, logging activities, timed access enforcement, audit trail export, and alerts for the owner panel.

## 1. Sync Users & Roles

- **Source:** Owner-panel users from Prisma (OwnerProfile, Organization.ownerUserId, OwnerTeamMember, UserContext). No external `/api/v1/owners` – internal DB is source of truth.
- **Actions:**
  - Owners (OwnerProfile or ownedOrgs) → Full access
  - Branch Manager / Staff (via BranchMember) → Limited access per scope
  - Team delegates (UserContext with ownerUserId set) → Scope-filtered access
- **Verification:** Permission integrity check after any role/scope change.

## 2. Log Activities

- **Source:** `OwnerOverviewLog` (existing) for team/delegation actions.
- **Monitored modules:** Products, Clinics, KYC, Branch Access.
- **Log format:**
  - `user_id` (actorUserId)
  - `action`
  - `timestamp` (createdAt)
  - `previous_state` / `new_state` (in meta)
- **Notifications:** Critical changes → Email/Slack (when configured).

## 3. Timed Access Enforcement

- **Schema:** `UserContext.accessStart`, `UserContext.accessEnd` (nullable DateTime).
- **Logic:** If set, login allowed only when `now >= accessStart && now <= accessEnd`.
- **Automation:** Job checks users with access windows; logs denied attempts.
- **Denied login log:** `DeniedLoginAttempt` table (userId, attemptedAt, reason).

## 4. Audit Trail

- **Export path:** `/backups/logs/YYYY-MM-DD.json`
- **Content:** OwnerOverviewLog entries for the day (and optionally AuditLog).
- **Schedule:** Daily at 00:00.
- **Rollback:** Manual – export format supports restore scripts (out of scope for Phase 1).

## 5. Alerts & Notifications

- **Unauthorized changes:** Immediate alert via Email & Slack (env: `SLACK_WEBHOOK_URL`, `ALERT_EMAIL`).
- **Sensitive module changes:** Notify Owners Team dashboard (in-app notification or webhook).

## 6. Automation Schedule

| Task                    | Interval   | Cron equivalent  |
|-------------------------|------------|------------------|
| Checks (sync verify)    | 1 hour     | `0 * * * *`      |
| Sync users & permissions| 6 hours    | `0 */6 * * *`    |
| Audit trail export      | Daily 00:00| `0 0 * * *`      |

## Touch Points

- `src/common/jobs/ownersTeamAutomation.job.ts` – Main job
- `src/common/services/ownersTeamAutomation.service.ts` – Logic
- `src/index.ts` – Register scheduler
- `prisma/schema.prisma` – Optional: accessStart, accessEnd, DeniedLoginAttempt

## Env Vars

- `OWNERS_AUTOMATION_ENABLED` – Set to `1` to run (default: `1`)
- `OWNERS_CHECK_INTERVAL_MS` – Hourly checks (default: 3600000)
- `OWNERS_SYNC_INTERVAL_MS` – 6-hour sync (default: 21600000)
- `OWNERS_AUDIT_EXPORT_DIR` – Base dir for logs (default: `./backups/logs`)
- `SLACK_WEBHOOK_URL` – Slack webhook for alerts
- `ALERT_EMAIL` – Email for critical alerts
