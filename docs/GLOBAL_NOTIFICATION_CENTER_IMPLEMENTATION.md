# Global Notification Center Implementation

## Overview

Single notification bell across Admin, Owner, Manager, and Staff panels. All alerts use the same topbar dropdown and API.

## Backend (API)

### Notification Model (extended)

Existing `Notification` model with added fields:
- `orgId`, `branchId` (nullable) – multi-tenant scope
- `severity` – info | warn | error | success
- `source` – module name (auth, clinic, order, producer, wallet, branch_access, etc.)

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/v1/notifications?unread=1&limit=10 | List notifications (recipients see only their own) |
| GET | /api/v1/notifications/unread-count | Unread count |
| GET | /api/v1/notifications/count | Alias for unread-count |
| POST | /api/v1/notifications/mark-read | Body: `{ ids: number[] }` – bulk mark read |
| POST | /api/v1/notifications/:id/read | Mark single as read |
| POST | /api/v1/notifications/read-all | Mark all as read (clear all) |

### Service Helpers

- `notifyUser(userId, payload)` – single user
- `notifyRole(orgId, branchId, role, payload)` – Owner or BRANCH_MANAGER
- `notifyMany(userIds, payload)` – multiple users

### Event Hooks (existing)

- Staff Branch Access Request → notify Owner + Manager + email
- Access approved → notify Staff + email
- Access rejected → notify Staff + email

## Frontend

### NotificationBell Component

- Shared component for Admin, Owner, Manager, Staff (via Larkon TopNavigationBar)
- Polls unread count every 15s, list every 30s
- Same-origin API, credentials included
- Role-aware View All links

### View All Routes (role-aware)

| Panel | View All URL |
|-------|--------------|
| Admin | /admin/notifications |
| Owner | /owner/notifications |
| Staff | /staff/branch |
| Shop/Clinic/Producer | /{panel}/notifications |
| Mother | /mother/notifications |
| Country | /country/notifications |

### UX

- Title, message, time-ago per item
- Click item → mark read + navigate to actionUrl
- No notifications: "No new notifications"
- Clear all: marks all as read

## Migration

```bash
cd backend-api
npx prisma migrate deploy
# Or in dev:
npx prisma migrate dev
```

Migration: `20260218000000_add_notification_org_branch_severity_source`

## Manual Test Plan

1. Staff creates branch access request → Owner sees bell update + email
2. Owner approves → Staff sees bell update + email
3. Unread count decreases when mark-read or clear-all
4. Bell works in Admin, Owner, Staff panels (same component)
5. View All navigates to correct panel page

## Files Changed

### Backend
- prisma/schema.prisma – Notification: orgId, branchId, severity, source
- prisma/migrations/20260218000000_*/migration.sql
- src/api/v1/services/notification.service.ts – extend CreateNotificationInput, add notifyUser/notifyRole/notifyMany
- src/api/v1/services/branchAccessNotification.service.ts – add source/orgId/branchId/severity to createNotification calls
- src/api/v1/modules/notifications/notifications.controller.ts – count alias, markReadBulk, select new fields
- src/api/v1/modules/notifications/notifications.routes.ts – GET /count, POST /mark-read

### Frontend
- lib/useNotifications.ts – 15s count poll, 30s list poll
- src/components/NotificationBell.jsx – time-ago, role-aware View All, "No new notifications"
- src/larkon-admin/.../Notifications.tsx – uses NotificationBell (already done)
- app/owner/(larkon)/notifications/page.jsx – use global API, add Clear all
- app/admin/(larkon)/notifications/page.tsx – new page
