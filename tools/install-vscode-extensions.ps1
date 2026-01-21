# BPA VS Code Extensions Installer (Windows)
# Run: powershell -ExecutionPolicy Bypass -File .\tools\install-vscode-extensions.ps1

$extensions = @(
  "dbaeumer.vscode-eslint",
  "esbenp.prettier-vscode",
  "prisma.prisma",
  "ms-azuretools.vscode-docker",
  "rangav.vscode-thunder-client",
  "humao.rest-client",
  "mikestead.dotenv",
  "bradlc.vscode-tailwindcss",
  "christian-kohler.path-intellisense",
  "formulahendry.auto-rename-tag",
  "formulahendry.auto-close-tag",
  "eamodio.gitlens",
  "github.vscode-pull-request-github",
  "usernamehw.errorlens",
  "streetsidesoftware.code-spell-checker",
  "redhat.vscode-yaml",
  "davidanson.vscode-markdownlint"
)

# Check VS Code CLI availability
$codeCmd = Get-Command code -ErrorAction SilentlyContinue
if (-not $codeCmd) {
  Write-Host "VS Code CLI 'code' not found." -ForegroundColor Yellow
  Write-Host "Fix: In VS Code -> Command Palette -> 'Shell Command: Install 'code' command in PATH'" -ForegroundColor Yellow
  exit 1
}

foreach ($ext in $extensions) {
  Write-Host "Installing: $ext"
  code --install-extension $ext --force | Out-Null
}

Write-Host "`n✅ Done. Restart VS Code now." -ForegroundColor Green
