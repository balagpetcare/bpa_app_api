# Error Fix Steps - Prisma Client

## Error
```
TypeError: Cannot read properties of undefined (reading 'branchAccessPermission')
```

## Quick Fix

### Step 1: Regenerate Prisma Client
```bash
cd D:\BPA_Data\backend-api
npx prisma generate
```

### Step 2: Restart Server
- Docker: `docker-compose restart bpa_api`
- Nodemon: Should auto-restart
- Manual: Stop and start server

### Step 3: Verify
```bash
# Test API
curl http://localhost:3000/api/v1/branch-access/check/1 \
  -H "Authorization: Bearer TOKEN"
```

## Why This Happens

After adding `BranchAccessPermission` model to schema:
1. ✅ Migration creates table in database
2. ❌ Prisma Client doesn't auto-regenerate
3. ✅ You must run `npx prisma generate`

## Prevention

Always run after schema changes:
```bash
npx prisma generate
```

## Complete Fix Script

```powershell
# Windows PowerShell
cd D:\BPA_Data\backend-api
Write-Host "Regenerating Prisma Client..." -ForegroundColor Yellow
npx prisma generate
Write-Host "✅ Done! Please restart your server." -ForegroundColor Green
```

## Verification

After regenerating, check:
- Server starts without errors
- API endpoints work
- No console errors about `branchAccessPermission`
