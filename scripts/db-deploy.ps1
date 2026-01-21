$ErrorActionPreference = 'Stop'

Write-Host "== BPA DB DEPLOY (migrate deploy + seed) ==" -ForegroundColor Cyan

Write-Host "npx prisma generate" -ForegroundColor Yellow
npx prisma generate

Write-Host "npx prisma migrate deploy" -ForegroundColor Yellow
npx prisma migrate deploy

Write-Host "npx prisma db seed" -ForegroundColor Yellow
npx prisma db seed
