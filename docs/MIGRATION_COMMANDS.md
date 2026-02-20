# Branch Access Permissions - Migration Commands

Complete migration commands for setting up the multi-branch staff permission system.

## Quick Start (All-in-One)

### Using npm script (Recommended)
```bash
cd D:\BPA_Data\backend-api
npm run migrate:branch-access
```

**Note:** If you get "Property 'branchAccessPermission' does not exist" error, run:
```bash
npx prisma generate
npm run backfill:branch-access
```

### Windows (PowerShell)
```powershell
cd D:\BPA_Data\backend-api
.\scripts\run-migration.ps1
```

### Linux/Mac (Bash)
```bash
cd D:\BPA_Data\backend-api
chmod +x scripts/run-migration.sh
./scripts/run-migration.sh
```

## Step-by-Step Commands

### Step 1: Generate Prisma Client
```bash
cd D:\BPA_Data\backend-api
npx prisma generate
```

### Step 2: Apply Migration

**Option A: Deploy migration (Production)**
```bash
npx prisma migrate deploy
```

**Option B: Create and apply (Development)**
```bash
npx prisma migrate dev --name add_branch_access_permissions
```

**Option C: Use existing migration file**
```bash
npx prisma migrate deploy
```

### Step 3: Verify Migration Status
```bash
npx prisma migrate status
```

Expected output should show:
```
Database schema is up to date!
Applied migrations:
  ...
  20260128113324_add_branch_access_permissions
```

### Step 4: Run Backfill Script
```bash
npx ts-node scripts/backfill-branch-access-permissions.ts
```

Or using npm:
```bash
npm run backfill:branch-access
```

### Step 5: Verify Data (Optional)

**Using Prisma Studio:**
```bash
npx prisma studio
```
Navigate to `branch_access_permissions` table to verify records.

**Using SQL:**
```sql
-- Connect to your database
psql -U your_user -d bpa_pet_db

-- Check total permissions
SELECT COUNT(*) FROM branch_access_permissions;

-- Check by status
SELECT status, COUNT(*)
FROM branch_access_permissions
GROUP BY status;

-- View sample records
SELECT
  bap.id,
  bap.status,
  b.name as branch_name,
  u.id as user_id,
  bap.approved_at,
  bap.expires_at
FROM branch_access_permissions bap
JOIN branches b ON b.id = bap."branchId"
JOIN users u ON u.id = bap."userId"
ORDER BY bap.created_at DESC
LIMIT 20;
```

## Complete Command Sequence

Copy and paste this entire block:

### Windows PowerShell
```powershell
# Navigate to project
cd D:\BPA_Data\backend-api

# Step 1: Generate Prisma Client
Write-Host "Generating Prisma Client..." -ForegroundColor Yellow
npx prisma generate

# Step 2: Apply Migration
Write-Host "Applying migration..." -ForegroundColor Yellow
npx prisma migrate deploy

# Step 3: Verify
Write-Host "Verifying migration..." -ForegroundColor Yellow
npx prisma migrate status

# Step 4: Backfill existing members
Write-Host "Running backfill..." -ForegroundColor Yellow
npx ts-node scripts/backfill-branch-access-permissions.ts

Write-Host "Migration completed!" -ForegroundColor Green
```

### Linux/Mac Bash
```bash
#!/bin/bash
# Navigate to project
cd D:\BPA_Data\backend-api

# Step 1: Generate Prisma Client
echo "Generating Prisma Client..."
npx prisma generate

# Step 2: Apply Migration
echo "Applying migration..."
npx prisma migrate deploy

# Step 3: Verify
echo "Verifying migration..."
npx prisma migrate status

# Step 4: Backfill existing members
echo "Running backfill..."
npx ts-node scripts/backfill-branch-access-permissions.ts

echo "Migration completed!"
```

## Troubleshooting Commands

### Fix: "Property 'branchAccessPermission' does not exist"

This error means Prisma Client wasn't regenerated after migration. Fix it:

```bash
# Regenerate Prisma Client
npx prisma generate

# Then run backfill
npm run backfill:branch-access
```

Or use the fix script (Windows):
```powershell
.\scripts\fix-migration.ps1
```

### Check if migration is already applied
```bash
npx prisma migrate status
```

### Mark migration as applied (if table exists but migration shows pending)
```bash
npx prisma migrate resolve --applied 20260128113324_add_branch_access_permissions
```

### Rollback migration (if needed)
```bash
npx prisma migrate resolve --rolled-back 20260128113324_add_branch_access_permissions
```

Then manually drop:
```sql
DROP TABLE IF EXISTS branch_access_permissions;
```

### Reset database (⚠️ WARNING: Deletes all data)
```bash
npx prisma migrate reset
```

### Check Prisma schema is valid
```bash
npx prisma validate
```

### Format Prisma schema
```bash
npx prisma format
```

## Environment Setup

Make sure your `.env` file has:
```env
DATABASE_URL="postgresql://user:password@localhost:5432/bpa_pet_db"
```

## Verification Checklist

After running migration, verify:

- [ ] Migration shows as applied: `npx prisma migrate status`
- [ ] Table exists: Check `branch_access_permissions` table in database
- [ ] Backfill completed: Check count matches active branch members
- [ ] All existing members have APPROVED status
- [ ] New enum values exist: `BranchAccessPermissionStatus`
- [ ] Notification types added: Check `NotificationType` enum

## Testing Commands

### Test API Endpoints

**1. Staff requests access:**
```bash
curl -X POST http://localhost:3000/api/v1/branch-access/request \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"branchId": 1}'
```

**2. Staff views requests:**
```bash
curl http://localhost:3000/api/v1/branch-access/my-requests \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**3. Manager views pending:**
```bash
curl http://localhost:3000/api/v1/branch-access/pending \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**4. Manager approves:**
```bash
curl -X POST http://localhost:3000/api/v1/branch-access/1/approve \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"expiresAt": "2026-12-31T23:59:59Z"}'
```

## Next Steps After Migration

1. **Set up cron job** (optional):
   ```bash
   # Add to crontab (runs daily at midnight)
   0 0 * * * cd /path/to/backend-api && npx ts-node src/common/jobs/expireBranchPermissions.job.ts
   ```

2. **Configure email** (if not already):
   - Set SMTP variables in `.env`
   - Test email delivery

3. **Update frontend**:
   - Add UI components for access management
   - Show pending access status
   - Manager approval interface

## Support

If you encounter issues:
1. Check migration status: `npx prisma migrate status`
2. Check database connection: Verify `DATABASE_URL` in `.env`
3. Check Prisma Client: Run `npx prisma generate`
4. Review logs: Check console output for errors
