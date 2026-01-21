$ErrorActionPreference = 'Stop'

Write-Host "== BPA DB SEED ==" -ForegroundColor Cyan

Write-Host "npx prisma generate" -ForegroundColor Yellow
npx prisma generate

Write-Host "npx prisma db seed" -ForegroundColor Yellow
npx prisma db seed
