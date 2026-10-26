@echo off
echo ========================================
echo BuildeX AWS Tools Installer
echo ========================================
echo.

echo This script will install:
echo 1. AWS CLI v2
echo 2. AWS SAM CLI
echo.
echo Requirements: Administrator privileges
echo.
pause

echo.
echo [1/3] Downloading AWS CLI installer...
powershell -Command "Invoke-WebRequest -Uri 'https://awscli.amazonaws.com/AWSCLIV2.msi' -OutFile '%TEMP%\AWSCLIV2.msi'"

echo [2/3] Installing AWS CLI...
msiexec /i "%TEMP%\AWSCLIV2.msi" /qn
if %errorlevel% neq 0 (
    echo ERROR: AWS CLI installation failed. Please run as Administrator.
    pause
    exit /b 1
)

echo [3/3] Downloading and installing AWS SAM CLI...
powershell -Command "Invoke-WebRequest -Uri 'https://github.com/aws/aws-sam-cli/releases/latest/download/AWS_SAM_CLI_64_PY3.msi' -OutFile '%TEMP%\SAM_CLI.msi'"
msiexec /i "%TEMP%\SAM_CLI.msi" /qn

echo.
echo ========================================
echo Installation Complete!
echo ========================================
echo.
echo Please close this window and open a NEW PowerShell/Command Prompt
echo to verify installation:
echo.
echo   aws --version
echo   sam --version
echo.
echo Then configure AWS credentials:
echo   aws configure
echo.
pause
