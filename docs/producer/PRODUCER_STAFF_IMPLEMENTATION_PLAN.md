# Producer Staff Management — Implementation Plan (Phase 1–3)

**Source of truth:** `docs/producer/PRODUCER_STAFF_CURRENT_STATE_AND_GAPS.md`  
**Scope:** Backend `src/api/v1/modules/producer/**`; Frontend `app/producer/**` (port 3105).

---

## Step 1 — Implementation Plan Summary

### P1: Resend Invite
- **Backend:** Add `resendStaffInvite(producerOrgId, inviteId, userId)` in `producerStaffInvite.service.ts`. For invite in PENDING/SENT: generate new token, set `tokenHash` (invite becomes link-based), extend `expiresAt` by INVITE_EXPIRY_DAYS, audit `STAFF_INVITE_RESENT`. Return `{ inviteLink, invite }`.
- **Route:** `POST /api/v1/producer/staff/invites/:id/resend` (auth, requireProducerOwner).
- **Controller:** `resendStaffInvite` in `producer.controller.ts`.
- **Frontend:** `producerStaffInviteResend(inviteId)` in `producerApi.js`; Staff page Invitations tab: "Resend" button for PENDING/SENT invites, show new link on success.

### P1: Disable Staff UI
- **Backend:** Already supports `PATCH /staff/:staffId/status` with body `{ status: "DISABLED" }` (allowed in `updateStaffStatus`).
- **Frontend:** Staff list actions: add "Disable" (set status DISABLED) and show "Enable" when status is DISABLED; reuse existing ConfirmStatusModal with status DISABLED/ACTIVE.

### P1: 403 UX
- **Frontend:** In `producerApi.js`, ensure API errors (403) are thrown with `status`, `message`, and `code` so callers can show "You don't have permission" or "Producer organization is suspended" instead of generic failure. Option: centralize response handling in apiFetch or in a small wrapper used by producer APIs to attach status/code to thrown error.

### P2: Enrich Audit (no DB migration)
- **Backend:** When writing STAFF_ROLE_UPDATED and STAFF_STATUS_UPDATED, pass enriched `entityId` string e.g. `staffId:123|oldRole:PRODUCER_VIEWER|newRole:PRODUCER_STAFF` and `staffId:123|oldStatus:ACTIVE|newStatus:DISABLED` so activity log has more context without schema change.

---

## Step 2 — Files to Change

| File | Change |
|------|--------|
| `backend-api/src/api/v1/modules/producer/producerStaffInvite.service.ts` | Add `resendStaffInvite(producerOrgId, inviteId, userId)`. |
| `backend-api/src/api/v1/modules/producer/producer.controller.ts` | Add `resendStaffInvite` handler; optional: pass old/new to audit for role/status. |
| `backend-api/src/api/v1/modules/producer/producer.routes.ts` | Add `POST /staff/invites/:id/resend`. |
| `bpa_web/app/producer/_lib/producerApi.js` | Add `producerStaffInviteResend`; improve error handling so 403 returns status/code/message. |
| `bpa_web/app/producer/(larkon)/staff/page.jsx` | Invitations tab: Resend button; Staff list: Disable/Enable action; handle 403 in toasts. |

---

## Step 3 — Verification (Code-Level)

- Owner visibility: `listProducts`/`listBatches` use `producerOrgId` only → confirmed.
- Disable blocks access: `updateStaffStatus(..., DISABLED)` increments `User.tokenVersion` → auth middleware rejects old JWT.
- Resend invalidates old token: `resendStaffInvite` sets new `tokenHash` and `expiresAt`; old link token no longer matches.

---

## Step 4 — Commit Strategy

1. `docs/producer/PRODUCER_STAFF_IMPLEMENTATION_PLAN.md` (this file).
2. Backend: resend invite (service + controller + route); getStaffMember + enriched audit entityId.
3. Frontend: Resend button, Disable/Enable, 403 UX (getProducerErrorMessage) and producerApi resend.

---

## Step 5 — Verification Checklist Results

| Check | Result |
|-------|--------|
| Owner visibility of staff-created data | **Pass** — listProducts/listBatches use producerOrgId only; no createdBy filter. |
| Disable blocks access | **Pass** — updateStaffStatus(..., DISABLED) increments User.tokenVersion; auth.middleware rejects JWT when tv !== user.tokenVersion. |
| Resend invalidates old token | **Pass** — resendStaffInvite generates new tokenHash and updates invite; old link token no longer matches. |
| Backend typecheck | **Note** — Producer-scope type error (listAuditLogs actor type) fixed. Other TS errors remain in dispatches, inventory, notifications, owner, email.worker (out of scope). |
| Frontend build | **Note** — Build reports 56 errors (e.g. apiErrorToMessage imports in other panels); no changes in app/producer introduced new errors. |
