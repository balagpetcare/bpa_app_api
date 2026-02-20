# Fix Migration - Regenerate Prisma Client and Run Backfill
# Run this if you get "Property 'branchAccessPermission' does not exist" error

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "Fixing Migration - Regenerating Prisma Client" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Regenerate Prisma Client
Write-Host "Step 1: Regenerating Prisma Client..." -ForegroundColor Yellow
npx prisma generate
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Failed to generate Prisma Client" -ForegroundColor Red
    exit 1
}
Write-Host "✅ Prisma Client regenerated" -ForegroundColor Green
Write-Host ""

# Step 2: Run Backfill
Write-Host "Step 2: Running backfill script..." -ForegroundColor Yellow
npx ts-node scripts/backfill-branch-access-permissions.ts
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Backfill failed" -ForegroundColor Red
    exit 1
}
Write-Host ""

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "✅ Migration fix completed!" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Cyan
