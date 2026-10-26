#!/usr/bin/env pwsh
# ==========================================
# BuildeX Coder IDE - Launch Script
# ==========================================
# This script launches the BuildeX Desktop IDE
# using the correct Electron executable

Write-Host ""
Write-Host "╔════════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║                  🚀 BUILDEX CODER IDE                          ║" -ForegroundColor Cyan
Write-Host "║              AI-Powered Development Environment                ║" -ForegroundColor Cyan
Write-Host "╚════════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# Check prerequisites
Write-Host "📋 Pre-flight checks..." -ForegroundColor Yellow
Write-Host ""

$allGood = $true

# Check if Electron is installed
if (-not (Test-Path "node_modules\electron\dist\electron.exe")) {
    Write-Host "✗ Electron not found!" -ForegroundColor Red
    Write-Host "  Run: npm install" -ForegroundColor White
    $allGood = $false
} else {
    Write-Host "✓ Electron installed" -ForegroundColor Green
}

# Check main.js
if (-not (Test-Path "main.js")) {
    Write-Host "✗ main.js not found!" -ForegroundColor Red
    $allGood = $false
} else {
    Write-Host "✓ main.js found" -ForegroundColor Green
}

# Check .env
if (-not (Test-Path ".env")) {
    Write-Host "✗ .env configuration missing!" -ForegroundColor Red
    $allGood = $false
} else {
    Write-Host "✓ .env configured" -ForegroundColor Green
}

# Check renderer.js
if (-not (Test-Path "renderer.js")) {
    Write-Host "✗ renderer.js not found!" -ForegroundColor Red
    $allGood = $false
} else {
    Write-Host "✓ renderer.js found" -ForegroundColor Green
}

Write-Host ""

if (-not $allGood) {
    Write-Host "❌ Pre-flight checks failed. Please fix the issues above." -ForegroundColor Red
    Write-Host ""
    exit 1
}

Write-Host "✅ All checks passed!" -ForegroundColor Green
Write-Host ""
Write-Host "🎯 Starting BuildeX IDE..." -ForegroundColor Cyan
Write-Host "   Press Ctrl+C in this window to stop the IDE" -ForegroundColor Gray
Write-Host ""
Write-Host "─" * 70 -ForegroundColor DarkGray
Write-Host ""

# Launch BuildeX using direct Electron executable
& "node_modules\electron\dist\electron.exe" .

# Exit code from Electron
$exitCode = $LASTEXITCODE

Write-Host ""
Write-Host "─" * 70 -ForegroundColor DarkGray
Write-Host ""

if ($exitCode -eq 0) {
    Write-Host "✅ BuildeX exited successfully" -ForegroundColor Green
} else {
    Write-Host "⚠️  BuildeX exited with code: $exitCode" -ForegroundColor Yellow
}

Write-Host ""
exit $exitCode
