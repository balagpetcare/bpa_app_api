# Producer Staff Invite — Email Templates & Variables

## Templates

| File | Purpose |
|------|--------|
| `src/utils/emailTemplates/producer_staff_invite.html` | Invitation email to invitee (branded; CTA = Accept invitation). |
| `src/utils/emailTemplates/producer_staff_invite_accepted.html` | Confirmation email to **owner** when a staff member accepts. |

## Invitation email (to invitee)

**Subject (example):** `You're invited to join {{orgName}} as {{roleLabel}}`

**Preview text:** You have been invited to join the producer organization as staff. Click the button to accept.

**Variables:**

| Variable | Description |
|----------|-------------|
| `{{orgName}}` | Producer org name. |
| `{{ownerName}}` | Display name of the inviter (owner). |
| `{{roleName}}` | Role label (e.g. Staff, Viewer). |
| `{{expiryDate}}` | Expiry date (locale medium). |
| `{{inviteLink}}` | Full URL to accept (from `FRONTEND_BASE_URL` + `/producer/invite?token=...`). |
| `{{customMessage}}` | Optional personal message from inviter (HTML snippet; may be empty). |

## Acceptance email (to owner)

**Subject (example):** `{{staffDisplayName}} accepted your staff invitation`

**Preview text:** A staff member has accepted your invitation to join your producer organization.

**Variables:**

| Variable | Description |
|----------|-------------|
| `{{ownerName}}` | Owner display name. |
| `{{staffDisplayName}}` | Display name of the person who accepted. |
| `{{orgName}}` | Producer org name. |
| `{{roleLabel}}` | Role they joined as. |
| `{{staffListUrl}}` | Full URL to Staff & Access Control page (e.g. `/producer/staff`). |

## Link format

- Invite link: `{FRONTEND_BASE_URL}/producer/invite?token={token}` (Producer panel; never backend host or 0.0.0.0).
- `/producer/invite?token=...` redirects to the accept flow; token is single-use.
- Resend creates a new token and invalidates the previous one; resend also enqueues email and creates a delivery record.
- Expiry is enforced; expired or invalid token returns a friendly error and owner guidance.

## Required environment variables

| Variable | Purpose |
|----------|---------|
| `FRONTEND_BASE_URL` or `WEB_APP_URL` | Public base URL for the Producer panel (e.g. `http://localhost:3105` or `https://producer.example.com`). Used for invite links in emails. If missing in dev, falls back to `http://localhost:3105`. Do not use `0.0.0.0`. |
| `REDIS_URL` (or `REDIS_HOST` + `REDIS_PORT`) | BullMQ queue for invite emails. If not set, worker does not start; UI still shows copyable link and delivery status. |
| SMTP (e.g. `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`) | Email delivery. If not configured, delivery record is updated to FAILED/SKIPPED and UI shows status; owner can copy link and share manually. |
