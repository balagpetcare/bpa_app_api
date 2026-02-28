# Producer Notifications – Baseline & Safety

## Step 0 — Safety (endpoints, response shape, panel)

### Backend (backend-api)

| What | Location |
|------|----------|
| **List** | `src/api/v1/modules/notifications/notifications.controller.ts` → `list()` |
| **Unread count** | Same file → `unreadCount()` |
| **Mark read** | Same file → `markRead()`, `markReadBulk()`, `readAll()` |
| **Analytics** | Same file → `analytics()` |
| **Routes** | `src/api/v1/modules/notifications/notifications.routes.ts` — GET `/`, GET `/unread-count`, GET `/count`, POST `/:id/read`, POST `/read-all`, POST `/mark-read`, GET `/analytics` |

**Response shape (list):**  
`{ success: true, data: { items: Array<Notification>, nextCursor?: string, hasMore?: boolean } }`  
Each item: `id`, `type`, `title`, `message`, `meta`, `priority` (DB P0/P1/P2), `actionUrl`, `readAt`, `createdAt`, `sender`, etc. **Consumers:** NotificationBell dropdown, /producer/notifications page, producer dashboard widget all use `data.items` and item fields; unknown top-level keys are ignored.

**Type / meta:**  
- `type`: DB enum `NotificationType` (Prisma schema).  
- `meta`: `Notification.meta` (Json?) stored and returned as-is.

**Panel filter (producer):**  
When `panel=producer`, `where.AND` includes:
- `OR: [ actionUrl startsWith "/producer", source "producer", type "STAFF_INVITE", type "BATCH_SUSPICIOUS_ACTIVITY" ]`  
- If `filter=actionRequired`: additionally `type IN [ VERIFICATION_CASE_REJECTED, BATCH_SUSPICIOUS_ACTIVITY ]`.

Unread-count uses the same panel OR; optional `filter=actionRequired` applied the same way (see upgrade doc).

---

## Priority (API layer, non-breaking)

When `panel=producer`, list response items include **`displayPriority`** (HIGH | MEDIUM | LOW):

- **HIGH:** VERIFICATION_CASE_REJECTED, BATCH_SUSPICIOUS_ACTIVITY  
- **MEDIUM:** STAFF_INVITE_ACCEPTED, VERIFICATION_CASE_APPROVED  
- **LOW:** SYSTEM_INFO, SYSTEM; default for unknown types  

Frontend uses `getProducerNotificationPriority(type)` and `getPriorityBadgeClass(priority)` (Larkon: danger / warning / secondary).

---

## Action Required

- **Tab:** "Action Required" on `/producer/notifications` calls list with `filter=actionRequired`.
- **Backend:** Restricts to types in `ACTION_REQUIRED_TYPES` (VERIFICATION_CASE_REJECTED, BATCH_SUSPICIOUS_ACTIVITY). Unread-count supports same `filter` for tab badge.

---

## Grouping (frontend-only)

Full notifications page groups by key `YYYY-MM-DD|type`. Each group shows type label, date, count, expand/collapse; optional "Mark group read" marks all unread in that group. Bell and dashboard remain ungrouped.

---

## New type: BATCH_SUSPICIOUS_ACTIVITY

- Included in producer panel OR; display priority HIGH; label "Batch Alert".  
- View href: `/producer/batches` or `/producer/batches/:batchId` from `meta.batchId`.  
- UI ready; emit when detection exists.

---

## Deep link

- **Notifications page:** `?highlight=id` or `?open=id` scrolls to and highlights the notification row.  
- **View hrefs:** Staff → `/producer/staff?highlight=inviteId|staffUserId`; KYC org → `/producer/kyc?case=caseId`; Product → `/producer/products/:id?focus=verification`; Batch → `/producer/batches/:id`.  
- **Staff page:** `?highlight=id` scrolls to and highlights the row (data-user-id, data-member-id, or data-invite-id); class `notification-highlight-row` for 2–3s.

---

## Retention job

- **Job:** `src/common/jobs/notificationRetention.job.ts`; scheduled from `src/index.ts`.  
- **Logic:** Read notifications with `readAt` older than N days → `status: EXPIRED`. Producer-only by default.  
- **Env:** `NOTIFICATIONS_RETENTION_DAYS_READ` (default 90), `NOTIFICATION_RETENTION_PRODUCER_ONLY` (default true), `NOTIFICATION_RETENTION_INTERVAL_MS` (default 24h).
