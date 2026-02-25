# Branch Access Permissions Migration Guide

This guide provides step-by-step instructions to migrate the database and set up the multi-branch staff permission system.

## Prerequisites

- PostgreSQL database is running
- Environment variables are configured (DATABASE_URL)
- Node.js and npm are installed
- Prisma CLI is available

## Step 1: Generate Prisma Client (if needed)

```bash
cd D:\BPA_Data\backend-api
npx prisma generate
```

## Step 2: Create and Apply Migration

### Option A: Use Existing Migration File (Recommended)

The migration file is already created at:
`prisma/migrations/20260128113324_add_branch_access_permissions/migration.sql`

Apply it using:

```bash
cd D:\BPA_Data\backend-api
npx prisma migrate deploy
```

Or if using development mode:

```bash
cd D:\BPA_Data\backend-api
npx prisma migrate dev --name add_branch_access_permissions
```

### Option B: Create Fresh Migration

If you need to regenerate the migration:

```bash
cd D:\BPA_Data\backend-api
npx prisma migrate dev --create-only --name add_branch_access_permissions
```

Then review the generated migration file and apply it:

```bash
npx prisma migrate dev
```

## Step 3: Verify Migration

Check that the migration was applied successfully:

```bash
cd D:\BPA_Data\backend-api
npx prisma migrate status
```

You should see the migration `20260128113324_add_branch_access_permissions` listed as applied.

## Step 4: Run Backfill Script

After the migration is applied, run the backfill script to grant existing staff members APPROVED access:

```bash
cd D:\BPA_Data\backend-api
npx ts-node scripts/backfill-branch-access-permissions.ts
```

Or using tsx (if installed):

```bash
cd D:\BPA_Data\backend-api
npx tsx scripts/backfill-branch-access-permissions.ts
```

Expected output:
```
[BACKFILL] Starting backfill of existing BranchMember records...
[BACKFILL] Found X active branch members.
[BACKFILL] Processed 100 permissions...
...
[BACKFILL] Summary:
  Created: X
  Skipped: 0
  Errors: 0
  Total: X

[BACKFILL] ✅ Backfill completed successfully!
```

## Step 5: Verify Data

Check that permissions were created:

```bash
cd D:\BPA_Data\backend-api
npx prisma studio
```

Or using SQL:

```sql
-- Check total permissions created
SELECT COUNT(*) FROM branch_access_permissions;

-- Check permissions by status
SELECT status, COUNT(*) 
FROM branch_access_permissions 
GROUP BY status;

-- Check a few sample records
SELECT 
  bap.id,
  bap.status,
  b.name as branch_name,
  u.id as user_id,
  bap.approved_at
FROM branch_access_permissions bap
JOIN branches b ON b.id = bap."branchId"
JOIN users u ON u.id = bap."userId"
LIMIT 10;
```

## Step 6: Test the System

1. **Test Staff Login**: Login as a staff member and verify access status is shown
2. **Test Manager Approval**: Login as a branch manager and check pending requests
3. **Test API Endpoints**: 
   - `GET /api/v1/branch-access/my-requests` (staff)
   - `GET /api/v1/branch-access/pending` (manager)
   - `POST /api/v1/branch-access/request` (staff)

## Rollback (if needed)

If you need to rollback the migration:

```bash
cd D:\BPA_Data\backend-api
npx prisma migrate resolve --rolled-back 20260128113324_add_branch_access_permissions
```

Then manually drop the table and enum:

```sql
DROP TABLE IF EXISTS branch_access_permissions;
-- Note: Enum values cannot be easily removed, they will remain in the database
```

## Troubleshooting

### Error: Migration already applied
If you see this error, the migration was already run. Check status:
```bash
npx prisma migrate status
```

### Error: Table already exists
If the table exists but migration shows as pending:
```bash
npx prisma migrate resolve --applied 20260128113324_add_branch_access_permissions
```

### Error: TypeScript compilation errors
Make sure TypeScript is properly configured:
```bash
npm install -D typescript @types/node ts-node
```

### Error: Prisma Client not generated
Regenerate Prisma Client:
```bash
npx prisma generate
```

## Post-Migration Checklist

- [ ] Migration applied successfully
- [ ] Backfill script completed without errors
- [ ] All existing staff have APPROVED permissions
- [ ] New staff login triggers permission request
- [ ] Manager receives email notifications
- [ ] API endpoints are accessible
- [ ] Permissions system correctly restricts access

## Next Steps

1. Set up cron job for expiration (optional):
   - Schedule `expireBranchPermissions.job.ts` to run daily
   - Schedule expiration warnings (3 days before)

2. Configure email settings:
   - Ensure SMTP is configured in `.env`
   - Test email delivery

3. Update frontend:
   - Add UI for staff to view access status
   - Add UI for managers to approve/reject requests
   - Show pending access warnings
