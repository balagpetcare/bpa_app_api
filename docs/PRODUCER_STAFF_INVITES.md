# Producer Staff Invites

## Overview

Producer staff can be invited in two ways:

- **Registered user**: Invitation creates an in-app notification; the user accepts or declines from the producer panel (or notification center).
- **Unregistered user**: Invitation creates a tokenized link; after the user registers with the same email/phone, they can open the link to accept and become staff.

## Current behavior (before this feature)

- `POST /api/v1/producer/staff` required the invitee to **already be a registered user**. If no user was found for the given email/phone, the API returned 404 "User not found with provided email/phone".
- The UI copy stated: "User must already be registered."
- There was no invite record or accept/decline flow; adding staff created a direct `ProducerOrgStaff` row with status ACTIVE.

## Gaps addressed

- No support for inviting by email/phone when the user is not yet registered.
- No explicit accept/decline step (audit and consent).
- No invite list or cancel/resend for the inviter.

## New design

### Data model

- **ProducerStaffInvite** table: `producerOrgId`, `invitedByUserId`, `email`, `phone`, `roleId`, `status` (PENDING | SENT | ACCEPTED | DECLINED | EXPIRED | CANCELLED), `tokenHash`, `expiresAt`, `acceptedByUserId`, timestamps.
- Uniqueness: one pending/sent invite per (producerOrgId, email) and per (producerOrgId, phone) (when not null).
- Token: stored as SHA-256 hash; raw token only in the invite link.

### API (under `/api/v1/producer`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/staff/invite` | Owner, verified | Create invite. Body: `{ email?, phone?, roleKey }`. Returns `{ mode: "REGISTERED"|"UNREGISTERED", inviteId, inviteLink? }`. |
| GET | `/staff/invites` | Owner | List invites (query: `status`, `search`). |
| POST | `/staff/invites/:id/cancel` | Owner | Cancel a pending/sent invite. |
| POST | `/staff/invites/accept` | Any auth | Accept invite. Body: `{ inviteId? }` or `{ token? }`. |
| POST | `/staff/invites/decline` | Any auth | Decline invite. Body: `{ inviteId? }` or `{ token? }`. |
| GET | `/me/pending-invites` | Any auth | List pending invites for the current user (by email/phone match). |

### Flows

1. **Registered (CASE A)**  
   Owner calls `POST /staff/invite` with email/phone. Backend finds user → creates `ProducerStaffInvite` (PENDING) → creates in-app notification (type `STAFF_INVITE`) for that user. Invitee sees banner or notification → Accept/Decline. On accept: create `ProducerOrgStaff` (ACTIVE), mark invite ACCEPTED.

2. **Unregistered (CASE B)**  
   Owner calls `POST /staff/invite`. No user found → create `ProducerStaffInvite` (SENT) with token and expiry → return `inviteLink`. Owner shares link. Invitee registers with same email/phone, then opens link → page calls `POST /staff/invites/accept` with `{ token }` → create staff, mark ACCEPTED.

### Backwards compatibility

- **POST /api/v1/producer/staff** is unchanged: still accepts email/phone and creates `ProducerOrgStaff` directly when the user exists. The new producer UI uses **POST /staff/invite** only, so both flows are supported without breaking existing callers.

### Security

- Token stored hashed; expiry enforced.
- Producer scope: only the producer org owner (or permitted roles) can list/cancel their invites.
- Accept/decline: logged-in user must match invite email/phone.
- No duplicate staff: existing `ProducerOrgStaff` for (producerOrgId, userId) is checked before creating from an invite.

## Producer panel (3105)

- **Invite modal**: New copy: "Enter email or phone. If they already have an account, they will receive an in-app invitation. If not, we'll send an invitation to register." On success, for UNREGISTERED show "Copy link" with `inviteLink`.
- **Staff page**: Tabs "Staff list" | "Invitations" | "Activity". Invitations table: Invitee, Role, Status, Sent, Expires, Actions (Cancel for pending/sent).
- **Pending-invites banner**: When the current user has pending invites (from `GET /me/pending-invites`), show a banner with Accept/Decline per invite.
- **Token accept page**: `/producer/invites/accept?token=...` — if not logged in, redirect to login with return URL; then show Accept/Decline and call accept or decline with `token`.

## Related

- Schema: `prisma/schema.prisma` — `ProducerStaffInvite`, `ProducerStaffInviteStatus`.
- Service: `src/api/v1/modules/producer/producerStaffInvite.service.ts`.
- Routes: `src/api/v1/modules/producer/producer.routes.ts`.
- Notifications: `STAFF_INVITE` type in `notification.service.ts` (createNotification).
- Producer Staff Architecture: [PRODUCER_STAFF_ARCHITECTURE.md](./PRODUCER_STAFF_ARCHITECTURE.md).
