# Notifications Real-Time System

Enterprise-grade notification system with Socket.IO, multi-tenant isolation, and real-time updates.

## Setup

### Migration

```bash
cd backend-api
npx prisma migrate deploy
npx prisma generate
```

Migration: `20260218120000_add_notification_sender_sound`
- Adds `senderId` to notifications
- Adds `soundEnabled` to user_notification_prefs
- Adds new NotificationType values (INVENTORY_STOCK_REQUEST, INVENTORY_LOW_STOCK, etc.)

### Environment

No additional env vars required. Socket.IO uses the same JWT secret as the API (`JWT_SECRET`).

### Run

```bash
npm run dev
```

Socket.IO attaches to the HTTP server at path `/api/v1/socket.io`.

## Events

| Event | Direction | Payload | Description |
|-------|-----------|---------|-------------|
| `connected` | server → client | `{ userId, orgId?, branchIds? }` | Sent on connect |
| `notification:new` | server → client | `{ notification }` | New notification created |
| `unread:count` | server → client | `{ count }` | Unread count updated (after mark-read) |

## Rooms

Clients join rooms based on auth context:

| Room | Format | When |
|------|--------|------|
| user | `user:{userId}` | Always (from JWT) |
| org | `org:{orgId}` | If orgId in token |
| branch | `branch:{branchId}` | If branchIds in token |

Notifications are emitted to `user:{userId}`. Org/branch rooms reserved for future role-based broadcasts.

## API

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/v1/notifications | List (scope=dropdown\|page, type, branchId, priority, from, to, unread) |
| GET | /api/v1/notifications/unread-count | Unread count |
| GET | /api/v1/notifications/analytics?range=7d\|30d | Analytics (by type, priority, unread) |
| POST | /api/v1/notifications/mark-read | Body: `{ ids: number[] }` |
| POST | /api/v1/notifications/read-all | Mark all read |
| POST | /api/v1/notifications/test | Dev only: create test notification |

## Frontend

- **Socket.IO client** connects to `API_BASE` with path `/api/v1/socket.io`, auth: `{ token }` from cookie/localStorage
- **Fallback**: If Socket.IO fails, falls back to legacy WebSocket at `/api/v1/realtime`
- **Polling**: Count poll 15s, list poll 30s (continues when socket disconnected)
- **Sound**: Plays on `notification:new` when `soundEnabled`, after user interaction, and when not on /notifications page

## Multi-Tenant / Branch Isolation

- Notifications are always scoped by `userId`; list API returns only current user's notifications
- `orgId`, `branchId` on Notification support future org/branch broadcast targeting
- Socket rooms enforce user-level delivery; org/branch rooms for future use
