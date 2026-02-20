# Fix Prisma Client in Docker Container
# Run this script when you see: "Cannot read properties of undefined (reading 'branchAccessPermission')"

Write-Host "`n=== Docker Prisma Client Fix ===" -ForegroundColor Cyan
Write-Host ""

# Check if container is running
$containerRunning = docker ps --filter "name=bpa_api" --format "{{.Names}}"

if ($containerRunning) {
    Write-Host "Container is running. Regenerating Prisma Client..." -ForegroundColor Yellow
    docker-compose exec bpa_api npx prisma generate
    Write-Host "Restarting container..." -ForegroundColor Yellow
    docker-compose restart bpa_api
} else {
    Write-Host "Container is not running. Rebuilding..." -ForegroundColor Yellow
    docker-compose build --no-cache bpa_api
    docker-compose up -d bpa_api
}

Write-Host ""
Write-Host "Waiting 5 seconds for startup..." -ForegroundColor Yellow
Start-Sleep -Seconds 5

Write-Host ""
Write-Host "Checking logs (last 30 lines)..." -ForegroundColor Yellow
Write-Host "---" -ForegroundColor Gray
docker-compose logs --tail=30 bpa_api
Write-Host "---" -ForegroundColor Gray

Write-Host ""
Write-Host "✅ Done! Check logs above for any errors." -ForegroundColor Green
Write-Host "If you see Prisma errors, try: docker-compose down && docker-compose build --no-cache bpa_api && docker-compose up -d" -ForegroundColor Yellow
