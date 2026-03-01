# Governance smoke QA – copy-paste steps

**Use this doc as the manual testing checklist for governance-related PRs.**  
Quick verification: migrate → seed → login → approve (with override) → batch freeze → suspend/unsuspend → Enforcement UI and Incident History tab.

## Prerequisites

- Backend API on port 3000, frontend (Next.js admin) on 3100–3105.
- DB URL configured (e.g. `.env`).

## 1. Migrate and seed

```bash
cd backend-api
npx prisma migrate deploy
npx prisma db seed
```

## 2. Confirm governance permissions in DB

After seeding, the **PLATFORM_ADMIN** role has all `admin.governance.*` permissions by default (see `prisma/seeders/seedGlobalCountryRoles.ts`), including:

- `admin.governance.incidents.manage`
- `admin.governance.batches.review`
- `admin.governance.enforcement.*`
- `admin.governance.analytics.read`
- etc.

Ensure at least one admin user is assigned the PLATFORM_ADMIN role (or a role that includes these keys) so they can use Producer Governance, Approvals, Batch Control, and Enforcement.

## 3. Login as admin

1. Open admin app (e.g. `http://localhost:3103/admin` or your Next.js admin port).
2. Log in with a user that has an admin role with governance permissions.

## 4. Approve product with compliance override

1. Go to **Producer Governance** → **Approvals queue** (or **Approvals**).
2. Open a pending product approval that shows compliance FAIL or warnings.
3. Use **Approve** with **Override compliance** checked and an override note.
4. Confirm the approval succeeds and an audit event is recorded (e.g. COMPLIANCE_OVERRIDE).

## 5. Batch freeze and verify print/export blocked

1. Go to **Producer Governance** → **Batch Control** (or **Batch Control**).
2. Find a batch and use **Freeze** (or equivalent).
3. As the producer (or via API), attempt **print** or **export** for that batch.
4. Verify the request returns **403** and a message indicating the batch is frozen (e.g. BATCH_FROZEN).

## 6. Suspend / unsuspend producer and verify incident and Enforcement UI

1. Go to **Producer Governance** → **Producers** and open a producer org detail.
2. Use **Suspend**; confirm success and note any **incidentId** in the response or UI.
3. Open **Moderation / enforcement** (Enforcement) and confirm the new incident appears in the list (filter by producer if needed).
4. Back on the producer detail, use **Unsuspend**; confirm success.
5. On the producer detail, open the **Incident History** tab (if your role has `admin.governance.incidents.manage`) and confirm incidents for this producer are listed.

## Manual test checklist (summary)

- [ ] Migrate + seed complete; PLATFORM_ADMIN has `admin.governance.*` in DB.
- [ ] Login as admin with governance role.
- [ ] Approve product with compliance override; audit shows COMPLIANCE_OVERRIDE.
- [ ] Freeze batch; print/export for that batch returns 403 (BATCH_FROZEN).
- [ ] Suspend producer; incident appears in Enforcement list and incidentId in response/UI.
- [ ] Unsuspend producer; Incident History tab shows incidents for that producer (when permission present).

For full regression and automated tests, see repo test commands and `docs/governance/IMPLEMENTATION_STATUS.md`.
