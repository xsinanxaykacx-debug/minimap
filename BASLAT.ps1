$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host ""
Write-Host " AYTAR MAP LAB" -ForegroundColor Cyan
Write-Host ""

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "Node.js bulunamadi. Node.js 20.19+ veya 22.12+ kurun." -ForegroundColor Red
    exit 1
}

$versionText = (& node -p "process.versions.node").Trim()
try { $version = [version]$versionText } catch {
    throw "Node.js surumu okunamadi: $versionText"
}

$supported = (($version.Major -eq 20 -and $version.Minor -ge 19) -or
              ($version.Major -eq 22 -and $version.Minor -ge 12) -or
              ($version.Major -ge 23))

Write-Host "Node.js: $versionText" -ForegroundColor DarkGray
if (-not $supported) {
    throw "Desteklenmeyen Node.js surumu: $versionText. Gerekli: 20.19+, 22.12+ veya daha yeni ana surum."
}

if (-not (Test-Path ".\node_modules")) {
    Write-Host "Bagimliliklar kuruluyor..." -ForegroundColor Cyan
    npm install
    if ($LASTEXITCODE -ne 0) { throw "npm install basarisiz." }
}

Write-Host "Uygulama: http://localhost:5173" -ForegroundColor Green
npm run dev
