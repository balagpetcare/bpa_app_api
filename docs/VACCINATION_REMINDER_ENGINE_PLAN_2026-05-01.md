# Vaccination Reminder Engine Plan

## 1. Goal
Send vaccination reminders before and after each pet vaccination `nextDueDate`, using the existing clinic vaccination records as the source of truth.

The target outcomes are:
- branch staff can see due and overdue vaccination reminder workload
- staff can trigger a reminder manually when needed
- owners/customers can receive reminders through channels already supported by the platform
- the system avoids duplicate sends when due dates are corrected or jobs retry

## 2. Existing Notification System
Current backend notification infrastructure is already strong enough to reuse for delivery, but not for reminder scheduling state.

### Models
- `Notification` in `prisma/schema.prisma`
  - stores in-app notification records
  - includes `type`, `priority`, `status`, `actionUrl`, `dedupeKey`, `orgId`, `branchId`, `severity`, `source`, `senderId`
- `NotificationDelivery`
  - stores channel delivery attempts per notification
  - channels currently supported in schema: `IN_APP`, `EMAIL`, `SMS`
  - statuses: `QUEUED`, `SENT`, `DELIVERED`, `FAILED`
- `UserNotificationPrefs`
  - stores per-user channel preferences
  - includes `allowEmail`, `allowSms`, `allowInApp`, quiet hours, and `enabledTypes`

### Services
- `src/api/v1/services/notification.service.ts`
  - `createNotification`, `notifyUser`, `notifyRole`, `notifyMany`
  - already supports `dedupeKey`
  - automatically creates an in-app delivery row
  - can enqueue email and SMS if allowed by user prefs
- `src/api/v1/services/notificationQueue.ts`
  - BullMQ queue wrappers for email and SMS
- `src/common/jobs/notificationWorker.ts`
  - processes `notif_email` and `notif_sms`
  - updates `NotificationDelivery` status and retry attempt counts

### Routes / controllers
- `/api/v1/notifications`
  - list, unread count, mark read, settings, analytics, test
- controller: `src/api/v1/modules/notifications/notifications.controller.ts`
- routes: `src/api/v1/modules/notifications/notifications.routes.ts`

### Reminder-specific stub already present
- `src/api/v1/modules/notifications/notification.service.ts`
  - contains reminder constants like `VACCINE_DUE`
  - `queueReminder()` is still TODO
  - `getPendingReminders()` returns empty data

### Important gap
- Prisma `NotificationType` does not currently include a vaccination-specific reminder type
- existing `Notification.dedupeKey` logic is short-window dedupe, not durable campaign/reminder state
- there is no persisted reminder schedule/history model today

## 3. Reminder Schedule Rules
Plan the engine around reminder stages tied to the vaccination row’s current `nextDueDate`.

### Baseline schedule
- 7 days before due date
- 3 days before due date
- on due date
- overdue follow-up after due date

### Recommended overdue cadence
- day 1 overdue
- day 7 overdue
- optional weekly follow-up afterward, capped by settings

### Eligibility rules
- only consider vaccination rows where `nextDueDate` is not null
- exclude `status = VOIDED`
- include corrected rows using the latest `nextDueDate`
- skip records where the pet or owner is deleted/inaccessible
- use branch visibility rules already used by vaccination dashboard logic

### Time logic
- run daily using local day boundaries chosen by org/branch policy
- compare using date-level semantics, not exact timestamp equality
- store the reminder stage explicitly so retries do not reschedule the same stage twice

## 4. Reminder Data Model
Recommendation: add a dedicated `VaccinationReminder` model and continue using existing `Notification` and `NotificationDelivery` for actual delivery.

### Recommended model choice
Use:
- `VaccinationReminder` as the scheduling, idempotency, audit, and resend-control record
- existing `Notification` rows for in-app visibility
- existing `NotificationDelivery` rows for channel send status

### Why not reuse only `Notification`
Reusing only `Notification` is not enough because the reminder engine needs durable reminder lifecycle data that `Notification` does not model well:
- one vaccination can have multiple stages across time
- due dates can be corrected, requiring stage invalidation or reschedule
- branch staff need “send now” and “already sent” state even when no channel delivery succeeded
- short-window `dedupeKey` does not prevent duplicate sends across days or after job retries
- reporting is easier with a reminder-centric table than by inferring from free-form notification metadata

### Suggested `VaccinationReminder` responsibility
The reminder row should represent one intended reminder stage for one vaccination and one recipient scope.

Suggested fields for later implementation:
- `id`
- `orgId`
- `branchId`
- `vaccinationId`
- `petId`
- `ownerUserId`
- `recipientUserId`
- `stage`
  - `BEFORE_7`
  - `BEFORE_3`
  - `DUE_TODAY`
  - `OVERDUE_1`
  - `OVERDUE_7`
  - future weekly follow-up if enabled
- `dueDateSnapshot`
- `scheduledForDate`
- `status`
  - `PENDING`, `SENT`, `FAILED`, `CANCELLED`, `SKIPPED`
- `channelPlan`
- `lastNotificationId`
- `lastAttemptAt`
- `attemptCount`
- `error`
- `createdAt`, `updatedAt`

Recommended uniqueness rule:
- unique on `(vaccinationId, recipientUserId, stage, dueDateSnapshot)`

That key is what protects the system when `nextDueDate` changes:
- same due date + same stage = same reminder
- corrected due date = new reminder series

## 5. Scheduler Design
Plan a daily backend job that generates or executes reminder stages from `nextDueDate`.

### Recommended approach
- add a dedicated daily job, similar in style to existing jobs in `src/common/jobs`
- the job should scan eligible vaccination records and materialize missing `VaccinationReminder` rows for the target day
- a second step in the same job can send pending reminders, or Phase C can keep generation and sending together if kept simple

### Existing scheduler/job pattern to follow
The repo already uses direct job entry files and npm scripts, for example:
- `src/common/jobs/expiryEngine.job.ts`
- `src/common/jobs/notificationRetention.job.ts`
- package scripts like `job:ai-forecast`, `job:wave4-rollup`

Follow that same pattern for vaccination reminders:
- one explicit job file
- one npm script entry
- cron or process supervisor triggers it externally once per day

### Daily job behavior
1. Select eligible vaccinations with non-null `nextDueDate` and non-`VOIDED` status.
2. Resolve branch/org/pet/owner context.
3. Determine whether today maps to any reminder stages.
4. Upsert/create `VaccinationReminder` rows idempotently.
5. For pending rows, build channel plan from user prefs plus available contact info.
6. Send in-app via `createNotification`.
7. Let existing email/SMS queue logic handle those channels through `NotificationDelivery`.
8. Mark reminder status based on result.

### Avoid duplicates
- durable unique key on reminder stage
- include `dueDateSnapshot`
- if a vaccination is corrected and due date changes, old future reminder rows should be cancelled
- manual “send now” should either:
  - create a `MANUAL` stage, or
  - create a reminder attempt linked to the same reminder row with separate metadata

### Branch / org scoping
- schedule rows should persist both `orgId` and `branchId`
- sending queries should filter by branch when staff are operating in a branch dashboard
- owner/customer delivery still uses the owner user/contact, but source branch must remain attached for UI and audit

### Retry failed notifications
- rely on existing queue retries for `EMAIL` and `SMS`
- keep `VaccinationReminder` status separate from `NotificationDelivery` so reminder-level retries can happen safely
- treat provider failure and missing contact as different outcomes

Recommended retry policy:
- retry transient failures on the same day
- do not recreate the reminder row
- record latest delivery failure on the reminder row

## 6. Channels
Use only channels that have actual infrastructure today, and mark others as future work.

### Available / partial today
- In-app notification: yes
  - fully supported by `Notification`
- Email: yes
  - queued through BullMQ
  - actual provider flow exists through mailer integration
- SMS: partial
  - queue and delivery rows exist
  - worker currently logs SMS send behavior rather than showing a real provider integration in this module

### Not found as existing infrastructure
- WhatsApp: no existing reminder delivery infrastructure found
- push/mobile app notification: no dedicated customer push delivery path found

### Contact source
Customer/owner contact is already available through pet owner user relations:
- vaccination staff UI reads owner from pet user auth/profile
- owner contact fields exist on user auth as `email` and `phone`

### Preference source
- backend has generic `UserNotificationPrefs`
- frontend owner settings page currently shows notification toggles, but it is not wired to the generic notifications settings API
- there is no owner/customer reminder-category-specific settings flow yet

### Channel rollout recommendation
Phase 1:
- in-app for owner user if account exists
- email if `allowEmail = true` and email exists
- SMS only after provider readiness is confirmed

Phase 2:
- WhatsApp if new provider/channel support is added

## 7. APIs
Plan these APIs under clinic branch scope, reusing vaccination branch context already used by staff pages.

### GET branch due/overdue reminders
Purpose:
- branch dashboard list for reminder operations
- due, overdue, sent status, last contact attempt, owner contact summary

Recommended route:
- `GET /api/v1/clinic/branches/:branchId/vaccinations/reminders`

Recommended filters:
- `status=due|overdue|upcoming|sent|failed`
- `stage=before_7|before_3|due_today|overdue`
- `ownerSearch=`
- `limit`, `cursor` or `page`

Response should include:
- vaccination id
- pet summary
- owner summary
- vaccine name
- `nextDueDate`
- due bucket
- reminder stage state
- last send status
- branch/org references

### POST send reminder now
Purpose:
- staff manually sends reminder for a single vaccination from branch dashboard

Recommended route:
- `POST /api/v1/clinic/branches/:branchId/vaccinations/:vaccinationId/send-reminder`

Body:
- optional channel override
- optional message template variant

Behavior:
- resolve current due status from latest vaccination
- create a manual reminder event/row
- send through approved channels only
- return reminder result plus delivery summary

### POST reschedule/reminder settings
Two scopes are useful and should be kept separate in implementation design.

Recommended branch/admin operational settings route:
- `POST /api/v1/clinic/branches/:branchId/vaccinations/reminder-settings`

Used for:
- enabling/disabling stage offsets
- overdue cadence
- branch default channels

Recommended owner/customer preference alignment:
- reuse or extend `/api/v1/notifications/settings`
- later add vaccination-specific opt-in/out inside `enabledTypes` or a dedicated structured prefs payload

## 8. Frontend Plan
### Branch vaccination dashboard reminder actions
Existing staff vaccination page already has:
- branch dashboard summary
- due/overdue counts from `staffClinicVaccinationDashboard`
- patient owner display with email/phone
- vaccination next-due list

Additive frontend plan:
- show reminder queue tab or section on staff branch vaccination page
- add filter chips for due, overdue, sent, failed
- show last reminder status and channel
- add `Send reminder now` action
- add lightweight reminder settings entry for branch admins

### Owner/customer notification view
Existing owner side already has:
- owner vaccination card page with `UPCOMING` and `OVERDUE` badges
- generic notifications UI

Frontend plan:
- surface vaccination reminders in existing owner notifications list
- deep-link notification `actionUrl` to owner vaccination card
- optionally add “last reminded” or “contact clinic” context on the owner vaccination card later

### Important frontend gap
- owner settings notification screen is currently a UI stub and does not align with generic notification prefs API
- reminder preferences should eventually be wired through the real notifications settings backend, not a separate placeholder endpoint

## 9. Risks
- duplicate reminders if due date corrections do not cancel old reminder stages
- wrong owner contact when pet-owner linkage is stale or shared incorrectly
- missing contact data when owner has account but no valid phone/email
- voided records being reminded if queries forget `status != VOIDED`
- corrected due dates sending old and new schedules in parallel
- SMS cost growth if overdue cadence is too aggressive
- email/SMS channel mismatch because current generic prefs are user-wide, not vaccination-specific
- branch visibility leakage if reminder queries do not reuse branch-safe vaccination visibility rules
- provider readiness gap because SMS infrastructure is only partially operational and WhatsApp is absent

## 10. Implementation Phases
### Phase A: data model / notification alignment
- add a dedicated vaccination reminder persistence model
- add a vaccination reminder notification type strategy
- define notification metadata shape and action URLs
- align reminder channel mapping with `UserNotificationPrefs`

### Phase B: branch due/overdue reminder API
- add branch reminder list endpoint
- derive due/overdue buckets from `nextDueDate`
- include reminder state, owner contact summary, and manual send eligibility
- keep this read-first and branch-safe

### Phase C: daily scheduler
- add daily job entry file and package script
- materialize/send reminder stages idempotently
- support correction-safe cancellation/rescheduling

### Phase D: send-now UI
- add branch vaccination dashboard reminder actions
- show send result and last status

### Phase E: customer notifications
- enable owner/customer-facing in-app + email delivery
- wire notification preference controls cleanly
- expand to SMS only after provider validation

## 11. Exact Next Implementation Command
Implement Phase A-B only: add a dedicated `VaccinationReminder` persistence model aligned with existing `Notification` and `NotificationDelivery`, add clinic branch APIs for due/overdue vaccination reminder listing and manual send-now preparation using `nextDueDate`, and do not build the daily scheduler or customer-channel rollout yet.

## Recommendation Summary
- Recommended reminder model: dedicated `VaccinationReminder` table plus reuse of existing `Notification` and `NotificationDelivery` for sends
- Recommended scheduler approach: one daily job file under `src/common/jobs`, triggered externally like other repo jobs, with durable reminder-stage idempotency keyed by vaccination, recipient, stage, and due-date snapshot
- Main risks: duplicate reminders after due-date correction, stale owner contact, voided-record leakage, channel/provider gaps, and notification cost escalation
