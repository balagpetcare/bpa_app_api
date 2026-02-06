# Troubleshooting Guide - Branch Access System (বাংলা)

## Common Errors এবং Solutions

### Error: "Cannot read properties of undefined (reading 'branchAccessPermission')"

**কারণ**: Prisma Client regenerate হয়নি নতুন model add করার পর।

**Solution**:

```bash
# Step 1: Regenerate Prisma Client
cd D:\BPA_Data\backend-api
npx prisma generate

# Step 2: Restart server
# Docker-এ restart করুন অথবা nodemon automatically restart করবে
```

**PowerShell Script**:
```powershell
.\scripts\regenerate-prisma-client.ps1
```

### Error: "Property 'branchAccessPermission' does not exist on type 'PrismaClient'"

**কারণ**: TypeScript Prisma Client types update হয়নি।

**Solution**:

```bash
# Regenerate Prisma Client
npx prisma generate

# Restart TypeScript server (VS Code-এ)
# Or restart your dev server
```

### Error: Migration already applied but table doesn't exist

**কারণ**: Migration apply হয়েছে কিন্তু table create হয়নি।

**Solution**:

```bash
# Check migration status
npx prisma migrate status

# If migration shows as applied but table missing:
# 1. Check database connection
# 2. Manually run migration SQL if needed
# 3. Or reset and reapply:
npx prisma migrate reset  # ⚠️ WARNING: Deletes all data
```

### Error: Backfill script fails

**কারণ**: Prisma Client not regenerated অথবা database connection issue।

**Solution**:

```bash
# Step 1: Regenerate Prisma Client
npx prisma generate

# Step 2: Verify database connection
# Check .env file DATABASE_URL

# Step 3: Run backfill again
npm run backfill:branch-access
```

### Error: Frontend shows "Access denied" but user has access

**কারণ**: Backend API response-এ access status missing অথবা frontend check logic issue।

**Solution**:

1. **Backend Check**:
   ```bash
   # Verify API response includes accessStatus
   curl http://localhost:3000/api/v1/auth/staff/context \
     -H "Authorization: Bearer YOUR_TOKEN"
   ```

2. **Frontend Check**:
   - Verify login response includes `branches[].accessStatus`
   - Check browser console for errors
   - Verify API calls are successful

### Error: Manager dashboard shows no pending requests

**কারণ**:
- Manager role check failing
- API endpoint issue
- Branch filter issue

**Solution**:

1. **Verify Manager Role**:
   ```sql
   SELECT * FROM branch_members
   WHERE userId = MANAGER_USER_ID
   AND role = 'BRANCH_MANAGER'
   AND status = 'ACTIVE';
   ```

2. **Check API Response**:
   ```bash
   curl http://localhost:3000/api/v1/branch-access/pending \
     -H "Authorization: Bearer MANAGER_TOKEN"
   ```

3. **Verify Component**: Check `StaffAccessApprovals.jsx` component is receiving correct `branchId`

## Pre-Deployment Checklist

- [ ] Prisma Client regenerated (`npx prisma generate`)
- [ ] Migration applied (`npx prisma migrate deploy`)
- [ ] Backfill script run (`npm run backfill:branch-access`)
- [ ] Server restarted
- [ ] API endpoints tested
- [ ] Frontend components tested
- [ ] Email notifications configured (SMTP)

## Quick Fix Commands

### Complete Reset (if needed)

```bash
# ⚠️ WARNING: This will delete all data
cd D:\BPA_Data\backend-api

# 1. Reset database
npx prisma migrate reset

# 2. Apply migrations
npx prisma migrate deploy

# 3. Regenerate client
npx prisma generate

# 4. Run backfill
npm run backfill:branch-access

# 5. Restart server
```

### Just Regenerate Client

```bash
npx prisma generate
```

### Just Run Backfill

```bash
npm run backfill:branch-access
```

## Verification Steps

### 1. Verify Database

```sql
-- Check table exists
SELECT * FROM branch_access_permissions LIMIT 1;

-- Check enum exists
SELECT unnest(enum_range(NULL::"BranchAccessPermissionStatus"));

-- Check permissions created
SELECT status, COUNT(*)
FROM branch_access_permissions
GROUP BY status;
```

### 2. Verify API

```bash
# Test check endpoint
curl http://localhost:3000/api/v1/branch-access/check/1 \
  -H "Authorization: Bearer TOKEN"

# Test pending endpoint (manager)
curl http://localhost:3000/api/v1/branch-access/pending \
  -H "Authorization: Bearer MANAGER_TOKEN"
```

### 3. Verify Frontend

1. Staff login করে
2. Branch selector-এ access status দেখে
3. Waiting page দেখে (যদি PENDING)
4. Manager dashboard-এ approval section দেখে

## Still Having Issues?

1. Check server logs for detailed error messages
2. Verify Prisma schema matches database
3. Check environment variables
4. Verify database connection
5. Check Prisma Client version compatibility
