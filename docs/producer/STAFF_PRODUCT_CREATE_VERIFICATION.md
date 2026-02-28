# Producer staff product create — verification

After deploying the fix for staff 403 on `POST /api/v1/producer/products`.

## Step 1 — Inspect the 403 payload (dev)

1. Open browser dev tools → Console.
2. As **staff**, try to create a product (e.g. Save draft on New Product).
3. On non-2xx, the frontend logs: `[apiFetch] non-2xx response: <status> <path> { code, message, data }`.
4. Note the **code**:
   - **PRODUCER_PERMISSION_DENIED** → staff role does not have `producer.products.write` (fix: run seed or assign role with permission).
   - **PRODUCER_ORG_ACCESS** → org mismatch, not active member, or org not verified (fix: ensure staff is ACTIVE in the org and send correct `producerOrgId`).

## Step 2 — Apply role/permission seed

PRODUCER_STAFF must have `producer.products.write` in the database. Run the **full** seed (which includes roles/permissions):

```bash
cd D:\BPA_Data\backend-api
npm run seed
```

Or the exact Prisma seed command from package.json:

```bash
npx prisma db seed
```

After run, you should see in the output:

```
[seedRolesPermissions] PRODUCER_STAFF has producer.products.write: true
```

If you see `false`, the role_permissions table was not updated; run seed again or check that `prisma/seeders/seedRolesPermissions.ts` includes `producer.products.write` in PRODUCER_STAFF.permissionKeys.

## Step 3 — Verify staff user's role in DB

Confirm the staff user’s **assigned role** has `producer.products.write`:

1. Find the staff user’s `ProducerOrgStaff` row (e.g. by `userId` and `producerOrgId`).
2. Note `roleId`; then check `Role` for that id (or key PRODUCER_STAFF / PRODUCER_MANAGER).
3. Check `RolePermission` for that role: there must be a row linking to permission key `producer.products.write`.

Example (Prisma Studio or SQL):

```sql
-- Permission id for producer.products.write
SELECT id, key FROM permissions WHERE key = 'producer.products.write';
-- Role id for PRODUCER_STAFF
SELECT id, key FROM roles WHERE key = 'PRODUCER_STAFF';
-- Role must have that permission
SELECT * FROM role_permissions WHERE roleId = <PRODUCER_STAFF_role_id> AND permissionId = <producer.products.write_id>;
```

## Step 4 — /me response shape (org id)

Backend `GET /api/v1/producer/me` returns `{ success: true, data: { user, org } }`. The client unwraps to `{ user, org }`. Use **org.id** as `producerOrgId` when creating a product. The frontend uses `me.org?.id ?? me.defaultProducerOrgId ?? me.orgId` and caches `/me` to avoid repeated calls.

## Manual checks

1. **Owner**  
   Log in as producer owner → create product → expect 201.

2. **Staff with permission + ACTIVE + correct org**  
   Log in as staff with role that has `producer.products.write` (PRODUCER_STAFF or PRODUCER_MANAGER). Ensure membership is ACTIVE and org is VERIFIED. Create product (frontend sends `producerOrgId` from `/me`) → expect 201.

3. **Staff without permission**  
   Role without `producer.products.write` → create product → expect 403 with **code: PRODUCER_PERMISSION_DENIED**.

4. **Org access mismatch**  
   Send `producerOrgId` for an org the user is not an active member of → expect 403 with **code: PRODUCER_ORG_ACCESS**.

5. **Missing producer org**  
   No `producerOrgId` and backend cannot infer → expect 400 with **code: PRODUCER_ORG_REQUIRED**.

## Curl examples (replace TOKEN and ORG_ID)

```bash
# Create product (owner or staff with permission)
curl -s -X POST "http://localhost:3000/api/v1/producer/products" \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"producerOrgId": ORG_ID, "productName": "Test Product", "sku": "SKU-001"}'
# Expect 201
```

## Backend 403 codes (requireProducerPermission)

| Code | Meaning |
|------|--------|
| PRODUCER_ORG_ACCESS | Not a member of any/the given producer org, or not ACTIVE, or org suspended/not verified. |
| PRODUCER_PERMISSION_DENIED | Member of org but role missing one or more required permissions (e.g. producer.products.write). |
