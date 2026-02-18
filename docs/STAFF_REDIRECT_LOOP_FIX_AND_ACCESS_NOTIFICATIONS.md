# Staff Redirect Loop Fix + Branch Access Notifications & Email

## Root Cause of Redirect Loop

**Loop:** `/staff` ↔ `/staff/branches` (infinite)

| File | Before | Effect |
|------|--------|--------|
| `app/staff/page.tsx` | `redirect("/staff/branches")` | `/staff` → `/staff/branches` |
| `app/staff/(larkon)/branches/page.jsx` | `router.replace("/staff")` | `/staff/branches` → `/staff` |

**Cycle:** Staff logs in → lands on `/staff` → server redirects to `/staff/branches` → client `useEffect` redirects to `/staff` → server redirects again → loop.

**Fix:** Use a single canonical route for the branch selector and remove conflicting redirects.

- `/staff` and `/staff/branches` both redirect to `/staff/branch` (branch selector).
- `/staff/branch` does not redirect; it is the stable page for staff with no approved branch or mixed status.

---

## Files Changed

### Frontend (bpa_web)

| File | Change |
|------|--------|
| `app/staff/page.tsx` | `redirect("/staff/branches")` → `redirect("/staff/branch")` |
| `app/staff/(larkon)/branches/page.jsx` | `router.replace("/staff")` → `router.replace("/staff/branch")`, idempotent redirect |
| `src/components/NotificationBell.jsx` | Staff `viewAllHref`: `/staff` → `/staff/branch`; Owner: `/owner/notifications` → `/owner/access/requests` |
| `src/larkon-admin/.../Notifications.tsx` | Use `NotificationBell` (real API) instead of mock data |

### Backend (backend-api)

| File | Change |
|------|--------|
| `src/api/v1/modules/owner/owner.controller.ts` | Call `notifyStaffOfApproval` on approve, `notifyStaffOfRevocation` on reject |
| `src/api/v1/services/branchAccessNotification.service.ts` | Add `notifyStaffOfRequestSubmitted`, update approval `actionUrl` to `/staff/branch` |
| `src/api/v1/modules/branch_access/branch_access.controller.ts` | Call `notifyStaffOfRequestSubmitted` when staff submits new access request |
| `src/utils/emailTemplates/branchAccessRequestConfirmation.html` | New template for staff confirmation email |

---

## Goal B: Notifications + Email

### Already Present

- **Notifications:** `Notification` model, `GET /api/v1/notifications`, `GET /api/v1/notifications/unread-count`
- **Owner/Manager notification on request:** `notifyOwnerOfAccessRequest`, `notifyManagerOfAccessRequest` (existing)
- **Staff approval email:** `notifyStaffOfApproval` (existing)
- **Staff revocation email:** `notifyStaffOfRevocation` (existing)

### Additions

1. **Owner approve/reject → staff notifications:** Owner controller now calls `notifyStaffOfApproval` and `notifyStaffOfRevocation`.
2. **Staff confirmation email:** `notifyStaffOfRequestSubmitted` sends confirmation when staff submits a request.
3. **Notification bell:** TopNavigationBar uses `NotificationBell`, which polls `/api/v1/notifications` every 30s and shows access requests.
4. **View-all links:** Staff → `/staff/branch`, Owner → `/owner/access/requests`.

---

## Manual Test Steps

### 1. Redirect loop fix

1. Log in as staff (Mother panel, port 3100).
2. Confirm redirect to `/staff/branch` (no loop).
3. Staff with pending access: stays on `/staff/branch`, polls every 10s.
4. Staff with approved access: redirected once to `/staff/branch/{branchId}`.
5. Staff with no branches: stays on `/staff/branch` with "Request access to a branch" message.

### 2. Access request notification and email

1. As staff, submit a branch access request (`POST /api/v1/branch-access/request`).
2. Confirm staff receives confirmation email ("Access request submitted").
3. As Owner/Manager, confirm bell shows unread count, dropdown lists the request, and email received with "Review Request" link (when SMTP configured).

### 3. Approval flow

1. As Owner, approve a request at `/owner/access/requests`.
2. Confirm staff receives notification and approval email.
3. Staff next login: redirects to branch dashboard without loop.

### 4. Rejection flow

1. As Owner, reject a pending request.
2. Confirm staff receives revocation notification and email.

---

## Environment

- **SMTP:** `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` for email delivery.
- **OWNER_WEB_URL:** (default `http://localhost:3104`) for review links in emails.
- Without SMTP, notifications still created; emails are logged instead of sent.
