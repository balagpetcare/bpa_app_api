# Move root-level .md files (except README.md) into docs/
# Run from backend-api: .\scripts\move-root-md-to-docs.ps1
# Root এ শুধু README.md রাখা হয়; বাকি সব .md docs/ এ যাবে।

$root = "D:\BPA_Data\backend-api"
$docs = "$root\docs"

# Root এ যেসব .md আছে সেগুলো (README.md ছাড়া) docs/ এ নিয়ে যাওয়া হবে
$files = @(
    "BPA_ANALYSIS_AND_ROADMAP.md",
    "BPA_CONTEXT_PACK.md",
    "BPA_MVP_DEVELOPER_GUIDE.md"
)

Set-Location $root
foreach ($f in $files) {
    $src = Join-Path $root $f
    if (Test-Path $src) {
        Copy-Item $src (Join-Path $docs $f) -Force
        Remove-Item $src -Force
        Write-Host "Moved: $f"
    }
}
Write-Host "Done."
