# BuildeX Backend Deployment Script
# Run this after configuring AWS credentials

Write-Host "═══════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "           🚀 DEPLOYING BUILDEX BACKEND                            " -ForegroundColor Green
Write-Host "═══════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

# Use aws.cmd (pip-installed AWS CLI) - note: no aws.exe on Windows
$awsExe = "C:\Users\likit\AppData\Roaming\Python\Python312\Scripts\aws.cmd"
$samExe = "C:\Users\likit\AppData\Roaming\Python\Python312\Scripts\sam.exe"

Write-Host "Checking AWS credentials..." -ForegroundColor Cyan
& $awsExe sts get-caller-identity 2>&1 | Out-Null

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ AWS credentials not configured!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please run:" -ForegroundColor Yellow
    Write-Host "   C:\Users\likit\AppData\Roaming\Python\Python312\Scripts\aws.cmd configure" -ForegroundColor Cyan
    Write-Host ""
    exit 1
}

Write-Host "✅ AWS credentials verified!" -ForegroundColor Green
Write-Host ""

# Navigate to backend directory
cd D:\Buildex_AWS\backend

# Step 1: Build
Write-Host "Step 1/2: Building Lambda functions..." -ForegroundColor Yellow
& $samExe build

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Build failed!" -ForegroundColor Red
    exit 1
}

Write-Host "✅ Build succeeded!" -ForegroundColor Green
Write-Host ""

# Step 2: Deploy
Write-Host "Step 2/2: Deploying to AWS..." -ForegroundColor Yellow
& $samExe deploy --no-confirm-changeset --no-fail-on-empty-changeset

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Deployment failed!" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "              ✅ BACKEND DEPLOYED SUCCESSFULLY!                    " -ForegroundColor Green
Write-Host "═══════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

# Verify deployment
Write-Host "Verifying deployment..." -ForegroundColor Cyan
$response = Invoke-WebRequest -Uri "https://vrgr3ltxr2.execute-api.ap-south-1.amazonaws.com/health" -UseBasicParsing

if ($response.StatusCode -eq 200) {
    Write-Host "✅ Health check passed!" -ForegroundColor Green
    Write-Host "   Response: $($response.Content)" -ForegroundColor Gray
} else {
    Write-Host "⚠️  Health check returned status: $($response.StatusCode)" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "🎉 Backend deployment complete!" -ForegroundColor Green
Write-Host ""
Write-Host "Changes deployed:" -ForegroundColor White
Write-Host "   ✅ Default credits changed from 500 → 0" -ForegroundColor Gray
Write-Host "   ✅ Credit deduction system enabled" -ForegroundColor Gray
Write-Host "   ✅ Insufficient credits error handling" -ForegroundColor Gray
Write-Host "   ✅ Real-time credit tracking" -ForegroundColor Gray
Write-Host ""
Write-Host "Next step: Deploy website with Amplify" -ForegroundColor Cyan
Write-Host ""
