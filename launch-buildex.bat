@echo off
REM ==========================================
REM BuildeX Coder IDE - Windows Launch Script
REM ==========================================

echo.
echo ╔════════════════════════════════════════════════════════════════╗
echo ║                  🚀 BUILDEX CODER IDE                          ║
echo ║              AI-Powered Development Environment                ║
echo ╚════════════════════════════════════════════════════════════════╝
echo.

REM Check if Electron exists
if not exist "node_modules\electron\dist\electron.exe" (
    echo ✗ Electron not found! Run: npm install
    echo.
    pause
    exit /b 1
)

echo ✓ Launching BuildeX IDE...
echo.

REM Launch using direct Electron executable
node_modules\electron\dist\electron.exe .

echo.
echo ✅ BuildeX closed
echo.
pause
