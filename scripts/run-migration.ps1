# Branch Access Permissions Migration Script (PowerShell)
# This script automates the migration process

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "Branch Access Permissions Migration" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Generate Prisma Client
Write-Host "Step 1: Generating Prisma Client..." -ForegroundColor Yellow
npx prisma generate
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Failed to generate Prisma Client" -ForegroundColor Red
    exit 1
}
Write-Host "✅ Prisma Client generated" -ForegroundColor Green
Write-Host ""

# Step 2: Apply Migration
Write-Host "Step 2: Applying migration..." -ForegroundColor Yellow
npx prisma migrate deploy
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Migration failed" -ForegroundColor Red
    exit 1
}
Write-Host "✅ Migration applied" -ForegroundColor Green
Write-Host ""

# Step 3: Verify Migration
Write-Host "Step 3: Verifying migration status..." -ForegroundColor Yellow
npx prisma migrate status
Write-Host ""

# Step 4: Run Backfill
Write-Host "Step 4: Running backfill script..." -ForegroundColor Yellow
npx ts-node scripts/backfill-branch-access-permissions.ts
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Backfill failed" -ForegroundColor Red
    exit 1
}
Write-Host ""

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "✅ Migration completed successfully!" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Cyan
