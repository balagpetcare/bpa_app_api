# Remove documentation/ folder (after moving its contents to docs/)
# Run from backend-api: .\scripts\remove-documentation-folder.ps1
# Run this locally if documentation/ still exists; sandbox may block delete.

$root = "D:\BPA_Data\backend-api"
$docDir = "$root\documentation"
if (Test-Path $docDir) {
  Remove-Item -Recurse -Force $docDir
  Write-Host "Removed documentation/"
} else {
  Write-Host "documentation/ not found. Nothing to do."
}
