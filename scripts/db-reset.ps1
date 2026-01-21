$ErrorActionPreference = 'Stop'

Write-Host "== BPA DB RESET (drop + migrate + seed) ==" -ForegroundColor Cyan

Write-Host "[1/3] npx prisma generate" -ForegroundColor Yellow
npx prisma generate

Write-Host "[2/3] npx prisma migrate reset --force" -ForegroundColor Yellow
npx prisma migrate reset --force

Write-Host "[3/3] npx prisma db seed" -ForegroundColor Yellow
npx prisma db seed
