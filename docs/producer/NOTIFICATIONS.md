# Producer Notifications (Approval & General)

## Overview

Producers receive in-app notifications for various events. Notifications are stored in the `Notification` table and delivered to the producer org **owner** (and optionally staff) via the existing notifications API. See [PRODUCER_NOTIFICATIONS.md](./PRODUCER_NOTIFICATIONS.md) for full API, response shape, and panel filter.

## Admin approval notifications

When an admin approves or rejects a **product** submission:

| Event | Notification type | Title | Message | actionUrl |
|-------|--------------------|-------|---------|-----------|
| Approved | `PRODUCT_APPROVED` | Product approved | Your product "{name}" has been approved. | `/producer/products/:id` |
| Rejected | `PRODUCT_REJECTED` | Product rejected | Your product "{name}" was rejected: {reason}. | `/producer/products/:id` |

- **Target:** Producer org owner (`ProducerOrg.ownerUserId`).
- **Meta:** `{ entityType: "PRODUCT", entityId: productId }`.
- **Source:** `producer`. These appear when the producer panel requests notifications with `panel=producer`.
- **Display:** Producer dashboard notification area and `/producer/notifications` page show these; `getProducerViewHref(item)` returns `/producer/products/:entityId` for PRODUCT_APPROVED / PRODUCT_REJECTED.
- **Priority (display):** PRODUCT_APPROVED = MEDIUM, PRODUCT_REJECTED = HIGH (action required).

## List response

- **GET** `/api/v1/notifications?panel=producer&scope=page&limit=50` returns `{ success: true, data: { items: Array, nextCursor, hasMore } }`.
- **Always use** `Array.isArray(data?.items) ? data.items : []` before rendering to avoid crashes on non-array responses.
- **Mark read:** PATCH/POST `/api/v1/notifications/:id/read` (see notifications controller).

## Badge count

- Unread count: GET `/api/v1/notifications/unread-count?panel=producer`.
- Producer dashboard and topbar can show a badge; existing `useNotifications` and notification bell integrate with this.
