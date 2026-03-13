# Doctor Invitation Flow – Root Cause Analysis & Fix

## 1. Root Cause Analysis

### Why the invitation flow was broken

1. **Staff/branch path (POST `/api/v1/clinic/branches/:branchId/doctors/invite`)**
   - **Behavior:** Only created a `ClinicApprovalRequest` (type `DOCTOR_INVITE`) and returned `{ id, type: "approval" }`. No `StaffInvite` was created and no email was sent.
   - **On owner approve:** The apply handler `applyDoctorInvite` was a **stub (TODO)** and did nothing. So after approval, still no invite record and no email.

2. **Owner path (POST `/api/v1/owner/clinic/branches/:branchId/doctors/invite`)**
   - **Behavior:** Correctly called `createStaffInvite` (StaffInvite + email via `inviteNotifier.sendInvite`). So owner-invite did create an invite and send email when SMTP is configured.
   - **In-app visibility:** Notifications for the **invitee** were only created **on login** (`createNotificationsForPendingInvites` in auth.controller). There was no dedicated “my invitations” API, so the doctor dashboard could not show pending invites without relying on the notification list.

3. **Doctor dashboard**
   - No dedicated “Invitations” or “Access Center” for clinic invitations. Owner dashboard had `StaffInviteNotifications` (filtering `/me/notifications` by `STAFF_INVITE`), but the doctor panel had no equivalent widget.

4. **Decline flow**
   - Declining from a notification only marked the notification as read. The `StaffInvite` status was left as `PENDING`, so the invite was not properly revoked.

5. **Duplicate invites**
   - `createStaffInvite` did not check for an existing PENDING invite for the same branch + email/phone, so duplicates could be created.

6. **Email failure visibility**
   - `sendInvite` could fail or run in “log only” mode when SMTP was not configured, but the caller did not log or expose this, so failures were easy to miss.

---

## 2. Code Changes Summary

### Backend (backend-api)

| File | Change |
|------|--------|
| `src/api/v1/services/clinicApprovalRequest.service.ts` | Extended `ApplyContext` with `decidedByUserId`. Implemented `applyDoctorInvite`: on approve of `DOCTOR_INVITE`, creates `StaffInvite` (inviteAsDoctor, email/phone/name from payload) and sends email via `createStaffInvite`. Passes `decidedByUserId` into all apply handlers. |
| `src/api/v1/services/staffInvite.service.ts` | Duplicate check: before creating, look for existing PENDING invite for same branch + (email or phone) and not expired; throw if found. After `sendInvite`, log result; on failure or fallback log, log clearly (inviteId, to, error/fallback). Invitation is still saved. |
| `src/api/v1/modules/me/me.controller.ts` | **Decline from notification:** When declining, update `StaffInvite` to `REVOKED` (by inviteId from notification meta). **New:** `getMyInvitations` (GET `/me/invitations`): list StaffInvites for current user (match by auth email/phone). **New:** `acceptInvitationById` (POST `/me/invitations/:id/accept`): verify invite belongs to user, then run same accept logic (BranchMember + ClinicStaffProfile for doctor). **New:** `declineInvitationById` (POST `/me/invitations/:id/decline`): verify invite belongs to user, set status to `REVOKED`. |
| `src/api/v1/modules/me/me.routes.ts` | Registered GET `/invitations`, POST `/invitations/:id/accept`, POST `/invitations/:id/decline`. |

### Frontend (bpa_web)

| File | Change |
|------|--------|
| `lib/api.ts` | Added `getMeInvitations()`, `acceptMeInvitation(id)`, `declineMeInvitation(id)` calling `/api/v1/me/invitations`. |
| `app/doctor/(larkon)/dashboard/_components/DoctorInvitationsWidget.tsx` | **New:** Widget that fetches `getMeInvitations()`, shows pending doctor invitations (status PENDING, inviteAsDoctor), with Accept/Decline. Renders only when there are actionable pending invites. |
| `app/doctor/(larkon)/dashboard/page.tsx` | Rendered `DoctorInvitationsWidget` near top of dashboard. |

### No schema/migration changes

- `StaffInvite` already had `REVOKED` and `EXPIRED` in enum; no Prisma change.

---

## 3. New APIs

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/me/invitations` | List staff invitations for the current user (matched by auth email/phone). Returns id, branchId, branchName, orgName, role, status, inviteAsDoctor, expiresAt, createdAt. |
| POST | `/api/v1/me/invitations/:id/accept` | Accept invitation by id. Invite must match current user’s email/phone. Creates/updates BranchMember and ClinicStaffProfile (DOCTOR) when inviteAsDoctor. |
| POST | `/api/v1/me/invitations/:id/decline` | Decline invitation by id; sets StaffInvite status to REVOKED. |

Existing endpoints still used:

- POST `/api/v1/me/notifications/:notificationId/accept-invite` – accept via notification (unchanged; decline now also sets invite to REVOKED).
- POST `/api/v1/me/notifications/:notificationId/decline-invite` – decline via notification; now updates invite to REVOKED.

---

## 4. Before vs After Flow

### Staff/branch invites doctor

- **Before:** Staff submits → only ClinicApprovalRequest created → owner approves → nothing else (stub). No StaffInvite, no email, doctor never sees invite.
- **After:** Staff submits → ClinicApprovalRequest created → owner approves → `applyDoctorInvite` runs → StaffInvite created + email sent (via existing inviteNotifier). Doctor gets email and, after login, notifications; doctor dashboard also shows invite via GET `/me/invitations` and DoctorInvitationsWidget.

### Owner invites doctor

- **Before:** StaffInvite + email worked; doctor only saw invite in-app after login (via notifications).
- **After:** Unchanged; in addition doctor can see and act on invites via GET `/me/invitations` and Accept/Decline by invite id.

### Doctor sees and acts on invite

- **Before:** Only via notification (after login) and accept/decline via notification ID.
- **After:** Via notifications (unchanged) **and** via “Clinic invitations” widget on doctor dashboard (GET `/me/invitations`) with Accept/Decline by invite id. Decline (from notification or by id) sets invite to REVOKED.

### Duplicates and email failures

- **Before:** No duplicate check; email failures not clearly logged.
- **After:** Duplicate PENDING invite for same branch + email/phone is rejected; send result is logged (and invite is still stored if send fails).

---

## 5. Manual QA Checklist

- [ ] **Staff invites doctor (approval flow)**  
  As branch manager, open staff clinic doctors → Invite Doctor → submit (email + phone + name).  
  As owner, open Approvals → approve the DOCTOR_INVITE request.  
  - Expect: StaffInvite created, invitation email sent (if SMTP configured).  
  - Invited user: after login, sees STAFF_INVITE notification and/or “Clinic invitations” on doctor dashboard; can Accept or Decline.

- [ ] **Owner invites doctor**  
  As owner, invite doctor from owner clinic branch (email/phone/name).  
  - Expect: StaffInvite created, email sent.  
  - Invited user: sees invite in notifications (after login) and in doctor dashboard widget; can Accept or Decline.

- [ ] **Doctor accepts from dashboard**  
  As invited doctor, open doctor dashboard → “Clinic invitations” → Accept.  
  - Expect: BranchMember + ClinicStaffProfile (DOCTOR) created/updated; invite status ACCEPTED; redirect or refresh shows new clinic in “My Clinics” / onboarding if needed.

- [ ] **Doctor declines from dashboard**  
  As invited doctor, open doctor dashboard → “Clinic invitations” → Decline.  
  - Expect: Invite status REVOKED; widget no longer shows that invite.

- [ ] **Doctor declines from notification**  
  As invited doctor, use notification → decline-invite.  
  - Expect: Invite status REVOKED; notification marked read.

- [ ] **Duplicate invite**  
  Create invite for same branch + email (or phone) while a PENDING invite exists.  
  - Expect: Error message about existing pending invitation.

- [ ] **Email not configured**  
  With SMTP disabled, create invite (owner or after approval).  
  - Expect: Invite record created; logs show fallback/skip (e.g. “SMTP not configured; invitation saved but email not sent”).

- [ ] **GET /me/invitations**  
  As logged-in user with pending staff invite (matching auth email/phone), GET `/api/v1/me/invitations`.  
  - Expect: 200, list including the pending invite(s) with branchName, orgName, status, inviteAsDoctor, expiresAt.

---

## 6. Files Touched (Summary)

**backend-api**

- `src/api/v1/services/clinicApprovalRequest.service.ts`
- `src/api/v1/services/staffInvite.service.ts`
- `src/api/v1/modules/me/me.controller.ts`
- `src/api/v1/modules/me/me.routes.ts`

**bpa_web**

- `lib/api.ts`
- `app/doctor/(larkon)/dashboard/_components/DoctorInvitationsWidget.tsx` (new)
- `app/doctor/(larkon)/dashboard/page.tsx`

**docs**

- `docs/DOCTOR_INVITATION_FLOW_FIX.md` (this file)

No new migrations; no changes to Prisma schema.
