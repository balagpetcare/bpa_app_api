# Regenerate Prisma Client Script
# Run this if you get "Cannot read properties of undefined (reading 'branchAccessPermission')" error

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "Regenerating Prisma Client" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "Step 1: Generating Prisma Client..." -ForegroundColor Yellow
npx prisma generate

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Failed to generate Prisma Client" -ForegroundColor Red
    exit 1
}

Write-Host "✅ Prisma Client regenerated successfully!" -ForegroundColor Green
Write-Host ""
Write-Host "Note: You may need to restart your server for changes to take effect." -ForegroundColor Yellow
Write-Host ""
