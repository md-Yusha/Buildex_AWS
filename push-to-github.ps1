# BuildeX Website - GitHub Push Script
# Run this after creating your GitHub repository

param(
    [Parameter(Mandatory=$true)]
    [string]$GitHubUsername,
    
    [Parameter(Mandatory=$false)]
    [string]$RepoName = "buildexide-website"
)

Write-Host "=== BuildeX Website GitHub Deployment ===" -ForegroundColor Cyan
Write-Host ""

# Navigate to website folder
cd D:\Buildex_AWS\website

# Check if git is initialized
if (!(Test-Path .git)) {
    Write-Host "❌ Git not initialized. Run 'git init' first." -ForegroundColor Red
    exit 1
}

# Show current status
Write-Host "Current Git Status:" -ForegroundColor Yellow
git status
Write-Host ""

# Add remote if not exists
$remoteUrl = "https://github.com/$GitHubUsername/$RepoName.git"
$existingRemote = git remote get-url origin 2>$null

if ($existingRemote) {
    Write-Host "Remote already configured: $existingRemote" -ForegroundColor Yellow
    $response = Read-Host "Replace with $remoteUrl? (y/n)"
    if ($response -eq 'y') {
        git remote set-url origin $remoteUrl
        Write-Host "✅ Remote URL updated" -ForegroundColor Green
    }
} else {
    Write-Host "Adding remote origin: $remoteUrl" -ForegroundColor Cyan
    git remote add origin $remoteUrl
    Write-Host "✅ Remote added" -ForegroundColor Green
}

Write-Host ""

# Verify remote
Write-Host "Remote configuration:" -ForegroundColor Yellow
git remote -v
Write-Host ""

# Rename branch to main if needed
$currentBranch = git branch --show-current
if ($currentBranch -ne "main") {
    Write-Host "Renaming branch $currentBranch -> main" -ForegroundColor Cyan
    git branch -M main
    Write-Host "✅ Branch renamed to main" -ForegroundColor Green
}

Write-Host ""

# Push to GitHub
Write-Host "Pushing to GitHub..." -ForegroundColor Cyan
Write-Host "Repository: https://github.com/$GitHubUsername/$RepoName" -ForegroundColor White
Write-Host ""

git push -u origin main

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "✅ Website pushed to GitHub successfully!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Cyan
    Write-Host "1. Enable GitHub Pages: https://github.com/$GitHubUsername/$RepoName/settings/pages"
    Write-Host "2. Configure Cloudflare DNS (see GITHUB_CLOUDFLARE_DEPLOY.md)"
    Write-Host "3. Set custom domain in GitHub Pages: buildexide.dev"
    Write-Host "4. Update Cognito callbacks with production URL"
    Write-Host ""
    Write-Host "View your repository: https://github.com/$GitHubUsername/$RepoName" -ForegroundColor White
} else {
    Write-Host ""
    Write-Host "❌ Push failed. Common issues:" -ForegroundColor Red
    Write-Host "- Repository doesn't exist on GitHub (create it first)"
    Write-Host "- Authentication failed (check GitHub credentials)"
    Write-Host "- Network issues"
    Write-Host ""
    Write-Host "Create repository: https://github.com/new" -ForegroundColor Yellow
}
