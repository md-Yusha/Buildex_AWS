# BuildeX AWS Tools Installer (PowerShell)
# Run as Administrator

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "BuildeX AWS Tools Installer" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "This script will install:" -ForegroundColor Yellow
Write-Host "  1. AWS CLI v2"
Write-Host "  2. AWS SAM CLI"
Write-Host ""

$confirmation = Read-Host "Continue? (Y/N)"
if ($confirmation -ne 'Y' -and $confirmation -ne 'y') {
    Write-Host "Installation cancelled." -ForegroundColor Red
    exit
}

Write-Host ""
Write-Host "[1/3] Downloading AWS CLI installer..." -ForegroundColor Green
try {
    Invoke-WebRequest -Uri "https://awscli.amazonaws.com/AWSCLIV2.msi" -OutFile "$env:TEMP\AWSCLIV2.msi"
    Write-Host "  ✓ Downloaded successfully" -ForegroundColor Green
} catch {
    Write-Host "  ✗ Download failed: $_" -ForegroundColor Red
    exit 1
}

Write-Host "[2/3] Installing AWS CLI..." -ForegroundColor Green
try {
    Start-Process msiexec.exe -ArgumentList "/i `"$env:TEMP\AWSCLIV2.msi`" /qn" -Wait -NoNewWindow
    Write-Host "  ✓ AWS CLI installed" -ForegroundColor Green
} catch {
    Write-Host "  ✗ Installation failed: $_" -ForegroundColor Red
    Write-Host "  Please run PowerShell as Administrator" -ForegroundColor Yellow
    exit 1
}

Write-Host "[3/3] Downloading and installing SAM CLI..." -ForegroundColor Green
try {
    Invoke-WebRequest -Uri "https://github.com/aws/aws-sam-cli/releases/latest/download/AWS_SAM_CLI_64_PY3.msi" -OutFile "$env:TEMP\SAM_CLI.msi"
    Start-Process msiexec.exe -ArgumentList "/i `"$env:TEMP\SAM_CLI.msi`" /qn" -Wait -NoNewWindow
    Write-Host "  ✓ SAM CLI installed" -ForegroundColor Green
} catch {
    Write-Host "  ✗ Installation failed: $_" -ForegroundColor Red
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Installation Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Please close this PowerShell window and open a NEW one" -ForegroundColor Yellow
Write-Host "to verify installation:" -ForegroundColor Yellow
Write-Host ""
Write-Host "  aws --version" -ForegroundColor White
Write-Host "  sam --version" -ForegroundColor White
Write-Host ""
Write-Host "Then configure AWS credentials:" -ForegroundColor Yellow
Write-Host "  aws configure" -ForegroundColor White
Write-Host ""
Write-Host "Press any key to exit..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
