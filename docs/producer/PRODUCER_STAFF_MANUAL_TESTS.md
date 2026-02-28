# Producer Staff Management — Manual Test Script

**Base URLs (adjust for your environment):**
- Producer panel: `http://localhost:3105` (or `PRODUCT_PANEL_URL` / port 3105)
- API: `http://localhost:3000/api/v1/producer` (or `NEXT_PUBLIC_API_BASE_URL`)

---

## 1) Resend invite → old link fails → new link works → staff registers

**Prerequisites:** Owner logged in at Producer panel; at least one **SENT** or **PENDING** invite for an unregistered email/phone.

| Step | Action | URL / Request | Expected result |
|------|--------|----------------|-----------------|
| 1.1 | Owner opens Staff → Invitations tab | `http://localhost:3105/producer/staff` (tab Invitations) | Invitations table shows pending/sent invites. |
| 1.2 | Owner clicks **Resend** on one invite | — | Button shows "Sending…"; then success toast; new invite link appears with Copy button. |
| 1.3 | Copy **old** invite link (from before resend), open in incognito | Old link (e.g. `/producer/invites/accept?token=OLD_TOKEN`) | Accept page may load but **submit** (e.g. set password) returns error: "Invalid or expired invite token" or 404. |
| 1.4 | Copy **new** invite link from UI, open in incognito | New link (e.g. `/producer/invites/accept?token=NEW_TOKEN`) | Page loads; invitee can set password and name; on submit, redirected or success and can log in as staff. |
| 1.5 | New staff logs in at Producer panel | `http://localhost:3105/producer/login` | Login succeeds; redirect to dashboard; staff sees org data (products/batches as per role). |

---

## 2) Disable staff → staff immediately blocked (token revoked) → cannot call producer APIs

**Prerequisites:** Owner and at least one ACTIVE staff; staff logged in (separate browser or incognito).

| Step | Action | URL / Request | Expected result |
|------|--------|----------------|-----------------|
| 2.1 | Staff calls any producer API (e.g. list products) | `GET /api/v1/producer/products` with staff cookie | 200; list of products (org-scoped). |
| 2.2 | Owner opens Staff list, finds that staff, clicks **Disable** and confirms | `http://localhost:3105/producer/staff` → Disable → Confirm | Success toast "Staff disabled". |
| 2.3 | Staff repeats same request (no new login) | `GET /api/v1/producer/products` with same cookie | **401** "Unauthorized: token revoked" (tokenVersion mismatch). |
| 2.4 | Staff opens Producer panel in same browser | `http://localhost:3105/producer/dashboard` | Redirect to login or 401 on API calls. |
| 2.5 | Owner sets staff back to **Enable** (ACTIVE) | Staff list → Enable → Confirm | Success. Staff can log in again and get new token; producer APIs work. |

---

## 3) 403 UX — owner-only action by staff → friendly message

**Prerequisites:** Staff user logged in at Producer panel (not owner).

| Step | Action | URL / Request | Expected result |
|------|--------|----------------|-----------------|
| 3.1 | Staff opens Staff page | `http://localhost:3105/producer/staff` | If staff has `producer.org.read`, list and tabs load. |
| 3.2 | Staff triggers an owner-only action (e.g. Invite Staff, or call PATCH/DELETE staff if UI allows) | e.g. POST `/api/v1/producer/staff/invite` as staff | **403** with body e.g. `{ success: false, message: "Only producer owners can perform this action" }`. |
| 3.3 | UI shows error | — | Toast or inline message shows the API message (e.g. "Only producer owners can perform this action") not a generic "Request failed" (via `getProducerErrorMessage`). |

---

## 4) Audit — role/status changes appear in Activity tab with old/new info

**Prerequisites:** Owner logged in; at least one staff member.

| Step | Action | URL / Request | Expected result |
|------|--------|----------------|-----------------|
| 4.1 | Owner opens Staff → Activity tab | `http://localhost:3105/producer/staff` → Activity | Audit log table loads (may be empty). |
| 4.2 | Owner changes a staff member’s **role** (e.g. Viewer → Staff) and confirms | Staff list → change role dropdown → confirm | Success toast; STAFF_ROLE_UPDATED appears in Activity. |
| 4.3 | Check Activity row for that action | — | Row shows action **STAFF_ROLE_UPDATED** and entity id/details containing old and new role (e.g. `staffId:123\|oldRole:PRODUCER_VIEWER\|newRole:PRODUCER_STAFF` in entityId or equivalent). |
| 4.4 | Owner changes same staff **status** (e.g. Suspend or Disable) and confirms | Staff list → Suspend or Disable → confirm | Success toast; STAFF_STATUS_UPDATED appears in Activity. |
| 4.5 | Check Activity row for status change | — | Row shows **STAFF_STATUS_UPDATED** with old/new status in entity details. |

---

## Quick smoke checklist

- [ ] Resend: new link works; old link fails after resend.
- [ ] Disable: staff token invalidated (401 on next producer API call).
- [ ] 403: staff sees friendly API message in UI.
- [ ] Activity: STAFF_ROLE_UPDATED and STAFF_STATUS_UPDATED show with old/new in entityId or details.
