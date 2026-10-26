# BuildeX IDE - Quick Test Script
# Run this to verify the desktop app is working

Write-Host "=== BuildeX IDE Production Test ===" -ForegroundColor Cyan
Write-Host ""

# Test 1: Check if backend is reachable
Write-Host "Test 1: Backend Health Check" -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "https://vrgr3ltxr2.execute-api.ap-south-1.amazonaws.com/health" -Method GET -UseBasicParsing
    if ($response.StatusCode -eq 200) {
        Write-Host "✅ Backend is online and responding" -ForegroundColor Green
    }
} catch {
    Write-Host "❌ Backend health check failed: $_" -ForegroundColor Red
}

Write-Host ""

# Test 2: Check Cognito configuration
Write-Host "Test 2: Cognito Configuration" -ForegroundColor Yellow
$userPoolId = "ap-south-1_DFJckvu7H"
$clientId = "1t0auvpbcr0lb9eb5c3tdunog5"
Write-Host "User Pool ID: $userPoolId"
Write-Host "Client ID: $clientId"

try {
    $poolInfo = python -m awscli cognito-idp describe-user-pool --user-pool-id $userPoolId --region ap-south-1 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Cognito User Pool exists" -ForegroundColor Green
    }
} catch {
    Write-Host "❌ Cognito check failed" -ForegroundColor Red
}

Write-Host ""

# Test 3: Check DynamoDB tables
Write-Host "Test 3: DynamoDB Tables" -ForegroundColor Yellow
$tables = @(
    "buildex-users-prod",
    "buildex-sessions-prod",
    "buildex-projects-prod",
    "buildex-progress-prod",
    "buildex-payments-prod",
    "buildex-chats-prod"
)

foreach ($table in $tables) {
    try {
        $tableInfo = python -m awscli dynamodb describe-table --table-name $table --region ap-south-1 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Host "✅ Table $table exists" -ForegroundColor Green
        } else {
            Write-Host "❌ Table $table not found" -ForegroundColor Red
        }
    } catch {
        Write-Host "❌ Table $table check failed" -ForegroundColor Red
    }
}

Write-Host ""

# Test 4: Launch the app
Write-Host "Test 4: Launching Desktop App" -ForegroundColor Yellow
Write-Host "Press Ctrl+C to stop the app when done testing" -ForegroundColor Cyan
Write-Host ""
Write-Host "Expected behavior:" -ForegroundColor White
Write-Host "1. App window opens with BuildeX logo"
Write-Host "2. Sign in redirects to Cognito (buildex-ide.auth.ap-south-1.amazoncognito.com)"
Write-Host "3. New users start with 0 credits"
Write-Host "4. AI chat attempts show 'insufficient credits' message"
Write-Host "5. Payment page shows ₹649 (2000 credits) and ₹1999 (10000 credits)"
Write-Host ""

Start-Sleep -Seconds 3

& ".\node_modules\electron\dist\electron.exe" .
