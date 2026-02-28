# Producer Notifications – Enterprise Upgrade Changelog

## Summary
Producer notification system upgraded with priority mapping, Action Required filter, grouping by type+day, deep linking, batch alert support, and read-notification retention. Existing APIs and panel isolation preserved.

---

## Files Modified

### Backend (backend-api)
- `prisma/schema.prisma` – Added `BATCH_SUSPICIOUS_ACTIVITY` to `NotificationType` enum (if not already present).
- `src/api/v1/modules/notifications/notifications.controller.ts` – Producer panel OR extended with `BATCH_SUSPICIOUS_ACTIVITY`; added `filter=actionRequired` for list; same OR in unreadCount and analytics.
- `src/common/jobs/notificationRetention.job.ts` – **New.** Soft-clean read notifications older than 90 days (status → EXPIRED).
- `src/index.ts` – Scheduled notification retention job (daily by default).

### Frontend (bpa_web)
- `app/producer/(larkon)/notifications/page.jsx` – Priority map and badges; Action Required tab and API param; TYPE_LABELS + getViewHref for BATCH_SUSPICIOUS_ACTIVITY; grouping by type+day with expand/collapse; deep link `?highlight=id` / `?open=id` with scroll and highlight.

---

## New Notification Types and Filters

### New type
- **BATCH_SUSPICIOUS_ACTIVITY** – Batch/code alert; shows in producer panel with HIGH priority. `actionUrl` or `meta.batchId` used for deep link to `/producer/batches` or `/producer/batches/:id`.

### Priority mapping (display)
- **HIGH:** `VERIFICATION_CASE_REJECTED`, `BATCH_SUSPICIOUS_ACTIVITY` → badge danger.
- **MEDIUM:** `STAFF_INVITE_ACCEPTED`, `VERIFICATION_CASE_APPROVED` → badge warning.
- **LOW:** `SYSTEM`, `SYSTEM_INFO` → badge secondary.

### Filters
- **Action Required** – New tab and backend support: `GET /api/v1/notifications?panel=producer&filter=actionRequired`. Returns only types that require action: `VERIFICATION_CASE_REJECTED`, `BATCH_SUSPICIOUS_ACTIVITY` (configurable via backend `actionRequiredTypes`).

---

## Deep linking
- **Query params:** `?highlight=:id` scrolls to and highlights the notification row; `?open=:id` same plus visual emphasis (e.g. border). Use for email/push links: `/producer/notifications?open=123`.
- **actionUrl / getViewHref:** Staff → `/producer/staff`; KYC (PRODUCER_ORG) → `/producer/kyc`; product (PRODUCER_PRODUCT + entityId) → `/producer/products/:id`; batch (meta.batchId) → `/producer/batches/:id` or `/producer/batches`.

---

## Retention
- Read notifications with `readAt` older than **90 days** are set to `status: EXPIRED` (producer-only by default).
- **Env vars:** `NOTIFICATIONS_RETENTION_DAYS_READ` (default 90), `NOTIFICATION_RETENTION_PRODUCER_ONLY` (default true). Job runs daily (env: `NOTIFICATION_RETENTION_INTERVAL_MS`).

---

## Performance
- Unread count and list still use single queries; no N+1. Action Required is an extra AND on type IN (…) when `filter=actionRequired`.
