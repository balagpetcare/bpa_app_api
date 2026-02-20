# REALTIME_NOTIFICATIONS_IMPLEMENTATION.md
Version: 1.0
Scope: BPA/WPA multi-dashboard (Owner/Admin/Shop/Clinic/Producer/Country/Branch)
Backend: Express API (port 3000) + PostgreSQL + Prisma
Frontends: Next.js multi apps (ports 3100+)

## 0) Goals (কি বানাবো)
1) In-app realtime notifications (badge/dropdown) সব ড্যাশবোর্ডে
2) "Action Required / Emergency" কে Priority-based ভাবে দেখানো
3) যেসব notification critical, সেখানে Email/SMS fallback
4) Server load কম (no heavy polling), scalable (multi-instance) architecture
5) Delivery tracking (sent/delivered/read), dedupe, rate-limit

---

## 1) Recommended Architecture (Best balance: load কম + realtime + scalable)

### 1.1 Primary Realtime: WebSocket Gateway
- In-app notifications + messages + POS status + emergency — সব একই channel দিয়ে চলবে
- Client token auth করে connect হবে
- user/org/branch rooms এ join করবে

### 1.2 Multi-instance scale: Redis Pub/Sub (or Redis Streams)
- API/WS server যদি একাধিক instance হয়, তাহলে Redis pub/sub দিয়ে broadcast
- Any instance থেকে event emit হলে, সব instance তাদের connected clients এ push করবে

### 1.3 Persistence: PostgreSQL (notifications + reads)
- Notification list, unread count, audit history — সব DB তে থাকবে
- WS শুধু "push transport", source of truth DB

### 1.4 Fallback: REST + light polling
- WS disconnect হলে:
  - initial load: GET notifications
  - fallback: 15-30s interval unread-count (very light)

### 1.5 Email/SMS: Async Queue (BullMQ/Redis-based recommended)
- Notification তৈরির সাথে সাথে Email/SMS পাঠাবে না (sync/blocking না)
- Queue worker background এ provider call করবে
- Retry, backoff, rate-limit, template rendering worker এ

✅ কেন এটা “সবচেয়ে ভালো”:
- WebSocket = realtime + efficient (polling কম)
- Redis Pub/Sub = scalable multi-server
- Queue = provider latency/timeout এ API slow হবে না
- DB = consistent state + read/unread history

---

## 2) Notification Types + Channel Policy (In-app vs Email vs SMS)

### 2.1 Priority levels
- P0: Emergency / Security / Payment Fraud / System Down
- P1: Action Required (approval, urgent stock, transfer receive, refund approval)
- P2: Informational (daily summary, general updates)

### 2.2 Channel rules (default)
- P0 → In-app realtime + Email + SMS (if phone exists) + optional voice later
- P1 → In-app realtime + Email (SMS optional based on setting/quiet hours)
- P2 → In-app realtime only (Email digest daily/weekly optional)

### 2.3 When Email/SMS should be sent (Examples)
#### Access/Approval
- Branch access request created (Owner) → P1 Email (optional SMS if enabled)
- Access approved/rejected (Branch Manager) → P1 Email

#### POS / Payments
- Refund request pending approval (Owner) → P1 Email
- Payment anomaly/fraud flag → P0 Email+SMS

#### Inventory / Logistics
- Stock transfer sent/received discrepancy → P1 Email
- Critical low stock for “must-have” SKU (owner-configurable threshold) → P1 Email
- Expired lots found in outbound attempt (possible compliance) → P0/P1 (policy based)

#### Security / Compliance
- Suspicious login, password changed, role changed → P0 (Email + optionally SMS)
- KYC rejected + resubmit needed → P1 Email

#### Emergency Button (SOS)
- Incident created (theft/animal emergency/staff safety) → P0 Email+SMS

### 2.4 User preferences & quiet hours
- Store notification preferences per user:
  - allowEmail, allowSms
  - quietHours (e.g., 12:00am–7:00am) for P1/P2
  - P0 always bypass quietHours (optional setting)

---

## 3) Data Model (Prisma suggestion)

### 3.1 notifications table
Fields:
- id (uuid)
- recipientUserId (nullable if scope-based broadcast)
- recipientScopeType: 'USER' | 'ORG' | 'BRANCH' | 'ROLE'
- recipientScopeId: string (orgId/branchId/roleKey/userId)
- title, body
- type (enum)
- priority (P0/P1/P2)
- actionUrl (string)
- metadata (jsonb)
- createdAt
- expiresAt (nullable)
- dedupeKey (nullable)  // prevent duplicates
- status: 'ACTIVE'|'EXPIRED'|'CANCELLED'

### 3.2 notification_reads table
- id
- notificationId
- userId
- readAt

### 3.3 notification_deliveries table (for email/sms tracking)
- id
- notificationId
- channel: 'IN_APP'|'EMAIL'|'SMS'
- toAddress (email/phone nullable for in_app)
- providerMessageId (nullable)
- status: 'QUEUED'|'SENT'|'DELIVERED'|'FAILED'
- error (text nullable)
- createdAt, updatedAt
- attemptCount

### 3.4 user_notification_prefs table (optional but recommended)
- userId
- allowEmail, allowSms
- quietHoursStart, quietHoursEnd
- enabledTypes (jsonb optional)
- createdAt, updatedAt

---

## 4) Server Components (Backend)

### 4.1 NotificationService (single source)
Responsibilities:
1) validate recipient scope
2) apply dedupe (if dedupeKey exists and recent duplicate -> skip/merge)
3) create notification row
4) create IN_APP delivery row as QUEUED/SENT
5) publish realtime event via Redis pubsub (or direct WS if single instance)
6) enqueue email/sms jobs (depending on policy + user prefs)

### 4.2 Realtime Gateway (WebSocket)
- Path: /api/v1/realtime (or /ws)
- Auth: JWT token from cookie/header/query (prefer header)
- On connect:
  - resolve userId, orgIds, branchIds, roles
  - join rooms:
    - user:{userId}
    - org:{orgId}
    - branch:{branchId}
    - role:{roleKey} (optional)
- Events to client:
  - notification:new {notification}
  - notification:unreadCount {count}
  - notification:updated {id, patch}

### 4.3 Redis Pub/Sub channels
- notif:user:{userId}
- notif:org:{orgId}
- notif:branch:{branchId}
- notif:role:{roleKey}
Payload: { event: 'notification:new', data: {notificationId} } (prefer small)
WS server will fetch full notification from DB or include minimal payload.

### 4.4 REST APIs (minimum)
- GET /api/v1/notifications?limit=20&cursor=
- GET /api/v1/notifications/unread-count
- POST /api/v1/notifications/:id/read
- POST /api/v1/notifications/read-all
- (optional) GET /api/v1/notifications/settings
- (optional) PUT /api/v1/notifications/settings

---

## 5) Email/SMS System (Queue-based)

### 5.1 Queue choice
Recommended: BullMQ (Redis) + separate worker process
- Queue names:
  - notif_email
  - notif_sms

### 5.2 Worker responsibilities
- fetch notification + user contact
- render template (HTML email / SMS text)
- call provider gateway
- update notification_deliveries status
- retry/backoff on transient failure

### 5.3 Template strategy
- email templates by type:
  - ACCESS_REQUEST, TRANSFER_DISCREPANCY, POS_REFUND_APPROVAL, SECURITY_ALERT, KYC_REJECTED, EMERGENCY_INCIDENT
- SMS: short format, include 1 deep-link (short URL optional)

### 5.4 Provider abstraction
Create interfaces:
- EmailProvider.send(to, subject, html, text)
- SmsProvider.send(to, text)
So later you can switch providers without changing core logic.

---

## 6) Navbar Integration (All dashboards)

### 6.1 Client flow
1) On app load:
   - GET unread-count
   - GET latest notifications list (optional)
2) Connect WS:
   - receive notification:new
   - update store:
     - unreadCount++
     - prepend list item
   - show toast for P0/P1

### 6.2 UI components
- <NotificationBell />
  - badge unreadCount
  - dropdown list (tabs: Action Required / All / System)
  - action buttons based on notification.metadata.actions
- <MessagesIcon /> (if applicable)
- <EmergencyButton /> (creates incident → triggers P0 notifications)

### 6.3 Read semantics
- click notification item:
  - optimistic mark read locally
  - POST /notifications/:id/read
  - navigate to actionUrl

### 6.4 Offline handling
- WS disconnect:
  - show small indicator (disconnected)
  - fallback polling (unread-count every 30s)

---

## 7) Performance & Load Control (must-have)
1) Avoid heavy polling; only unread-count fallback
2) Send minimal pubsub payload; fetch details on demand
3) Deduplicate spam events:
   - same dedupeKey within 2 minutes => merge/update instead of new row
4) Rate limit per user:
   - max X notifications/minute for P2
5) Email/SMS throttling:
   - combine P2 into digest
6) Indexing:
   - notifications(recipientUserId, createdAt)
   - reads(userId, readAt)
7) Pagination via cursor (createdAt + id)

---

## 8) Security rules
- WS must authenticate with JWT
- Never trust client for scope; server decides rooms
- Notification payload must not leak other org/branch data
- Audit: store who triggered notification (actorUserId) in metadata

---

## 9) Implementation Plan (Step-by-step tasks)

### Phase A — DB + REST
- [ ] Add Prisma models: Notification, NotificationRead, NotificationDelivery, UserNotificationPrefs
- [ ] Migration run
- [ ] Implement REST endpoints list/count/read/read-all
- [ ] Seed basic notification types

### Phase B — Realtime
- [ ] Add WS gateway (socket.io/ws)
- [ ] Authenticate + join rooms
- [ ] Redis pub/sub integration
- [ ] NotificationService publish hook

### Phase C — Navbar UI
- [ ] Create shared notification store/hook in each Next.js app
- [ ] Add NotificationBell dropdown UI
- [ ] Hook WS events → update UI
- [ ] Add fallback polling

### Phase D — Email/SMS
- [ ] Add BullMQ queues + worker process
- [ ] Implement provider abstraction
- [ ] Create templates + policy rules
- [ ] Delivery tracking table updates

### Phase E — Hardening
- [ ] Dedupe, rate-limit, quiet hours
- [ ] P0 escalation UX (banner/toast)
- [ ] Observability logs + metrics

---

## 10) Testing Checklist
- [ ] New notification appears instantly in navbar without refresh
- [ ] Unread count increments/decrements correctly
- [ ] Read state persists across devices
- [ ] WS reconnect does not duplicate notifications
- [ ] Email/SMS queued and delivered; failure retries
- [ ] Multi-instance test: emit on instance A received by client on instance B

---

## 11) Minimal Event Contract (final)
Server -> Client
- notification:new
- notification:unreadCount
- notification:updated

Client -> Server (optional)
- notification:ping (keepalive)
- notification:read (optional; REST can handle)

---

## 12) Notes (Project-specific)
- API must remain on port 3000
- Next.js ports remain fixed (owner 3104, admin 3103, clinic 3102, shop 3101, mother 3100, producer 3105, country 3106)
- No destructive changes: merge changes without deleting existing code.
