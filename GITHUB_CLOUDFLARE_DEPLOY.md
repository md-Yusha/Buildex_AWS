# GitHub + Cloudflare Deployment Guide

Deploy BuildeX IDE website to https://buildexide.dev via GitHub Pages + Cloudflare.

---

## Prerequisites

- [x] Git initialized in website/ folder
- [x] Initial commit created (13 files)
- [ ] GitHub account with repository access
- [ ] Cloudflare account with buildexide.dev domain

---

## Step 1: Create GitHub Repository

### Option A: Via GitHub CLI (if installed)
```powershell
cd website
gh repo create buildexide-website --public --source=. --remote=origin
gh repo view --web
```

### Option B: Via GitHub Web (Manual)
1. Go to: https://github.com/new
2. Repository name: `buildexide-website` (or any name)
3. Visibility: **Public** (required for free GitHub Pages)
4. **Do NOT** initialize with README, .gitignore, or license (we already have them)
5. Click "Create repository"

---

## Step 2: Connect Local Repository to GitHub

After creating the repository, copy the commands shown by GitHub:

```powershell
cd D:\Buildex_AWS\website

# Add GitHub as remote origin
git remote add origin https://github.com/YOUR-USERNAME/buildexide-website.git

# Verify remote
git remote -v

# Push to GitHub
git branch -M main
git push -u origin main
```

**Replace `YOUR-USERNAME`** with your actual GitHub username.

---

## Step 3: Enable GitHub Pages

1. Go to your repository: `https://github.com/YOUR-USERNAME/buildexide-website`
2. Click **Settings** tab
3. Scroll to **Pages** section (left sidebar)
4. Under "Build and deployment":
   - **Source:** Deploy from a branch
   - **Branch:** `main` (or `master`)
   - **Folder:** `/ (root)`
5. Click **Save**
6. Wait 1-2 minutes for deployment
7. GitHub will show: "Your site is live at `https://YOUR-USERNAME.github.io/buildexide-website/`"

---

## Step 4: Configure Cloudflare for buildexide.dev

### 4.1 Add DNS Records in Cloudflare

Login to Cloudflare dashboard → Select `buildexide.dev` domain → DNS → Records:

**Add CNAME Record:**
```
Type:    CNAME
Name:    @  (or buildexide.dev for root domain)
Target:  YOUR-USERNAME.github.io
Proxy:   ✅ Proxied (orange cloud)
TTL:     Auto
```

**Add CNAME for www (optional):**
```
Type:    CNAME
Name:    www
Target:  YOUR-USERNAME.github.io
Proxy:   ✅ Proxied
TTL:     Auto
```

### 4.2 Configure GitHub Custom Domain

Back in GitHub repository settings → Pages:

1. Under "Custom domain", enter: `buildexide.dev`
2. Click **Save**
3. Wait for DNS check (1-5 minutes)
4. Once verified, enable **Enforce HTTPS** ✅

### 4.3 Cloudflare SSL/TLS Settings

Cloudflare → SSL/TLS:
- **Encryption mode:** Full (or Full strict if you have GitHub Pages SSL)
- **Always Use HTTPS:** On ✅
- **Automatic HTTPS Rewrites:** On ✅

---

## Step 5: Update Cognito Callbacks

Once buildexide.dev is live, update Cognito to allow login from your domain:

```powershell
python -m awscli cognito-idp update-user-pool-client `
  --user-pool-id ap-south-1_DFJckvu7H `
  --client-id 1t0auvpbcr0lb9eb5c3tdunog5 `
  --callback-urls "https://buildexide.dev/auth/callback" "buildexcoder://auth/callback" `
  --logout-urls "https://buildexide.dev" "buildexcoder://logout" `
  --allowed-o-auth-flows "code" `
  --allowed-o-auth-scopes "email" "openid" "profile" `
  --allowed-o-auth-flows-user-pool-client `
  --supported-identity-providers "COGNITO" `
  --region ap-south-1
```

---

## Step 6: Verify Deployment

1. **Visit:** https://buildexide.dev
2. **Check HTTPS:** Green padlock in browser
3. **Test Login:** Click "Sign In" → Redirects to Cognito
4. **After Login:** Redirects back to buildexide.dev
5. **Check Credits:** New users show 0 credits
6. **Test Payment:** Payment page shows ₹649 and ₹1999 plans

---

## Future Updates

To update the website, simply:

```powershell
cd D:\Buildex_AWS\website

# Make changes to files...

# Commit and push
git add .
git commit -m "Update: description of changes"
git push origin main
```

Cloudflare + GitHub Pages automatically deploys within 1-2 minutes.

---

## Quick Reference

### Git Commands
```powershell
# Check status
git status

# Stage changes
git add .

# Commit
git commit -m "Your message"

# Push to GitHub
git push origin main

# View commit history
git log --oneline

# Create new branch
git checkout -b feature-name
```

### Repository Structure
```
website/                     → GitHub repo root
├── .git/                   → Git metadata (never edit)
├── .gitignore              → Ignored files
├── README.md               → Repo documentation
├── index.html              → Main landing page
├── styles.css              → Styles
├── app.js                  → JavaScript
├── version.json            → Version info
└── assets/                 → Images
    ├── logo.png
    ├── icon.png
    ├── buildex-ide-real.png
    └── ...
```

### URLs
- **GitHub Repository:** https://github.com/YOUR-USERNAME/buildexide-website
- **GitHub Pages (temp):** https://YOUR-USERNAME.github.io/buildexide-website/
- **Production (Cloudflare):** https://buildexide.dev
- **Backend API:** https://vrgr3ltxr2.execute-api.ap-south-1.amazonaws.com

### Cognito
- **User Pool ID:** ap-south-1_DFJckvu7H
- **Client ID:** 1t0auvpbcr0lb9eb5c3tdunog5
- **Domain:** buildex-ide.auth.ap-south-1.amazoncognito.com

---

## Troubleshooting

### Issue: "404 Not Found" on buildexide.dev
- **Fix:** Wait 5-10 minutes for DNS propagation
- **Check:** Cloudflare DNS records are proxied (orange cloud)
- **Verify:** GitHub Pages custom domain is set to buildexide.dev

### Issue: "Too many redirects"
- **Fix:** Cloudflare SSL mode should be "Full" not "Flexible"
- **Check:** GitHub Pages "Enforce HTTPS" is enabled

### Issue: Login fails with Cognito redirect error
- **Fix:** Ensure Cognito callbacks include `https://buildexide.dev/auth/callback`
- **Check:** Run the `update-user-pool-client` command from Step 5

### Issue: Changes not appearing on buildexide.dev
- **Fix:** Clear Cloudflare cache: Cloudflare → Caching → Purge Everything
- **Wait:** GitHub Pages deployment takes 1-2 minutes
- **Check:** `git log` shows your commit was pushed

---

## Next Steps After Deployment

1. [ ] Push website to GitHub
2. [ ] Configure Cloudflare DNS
3. [ ] Enable GitHub Pages custom domain
4. [ ] Update Cognito callbacks
5. [ ] Test complete user flow
6. [ ] Clear DynamoDB test data
7. [ ] Update Electron app with production API
8. [ ] Create installer for desktop app (.exe, .dmg)
9. [ ] Set up monitoring (CloudWatch, Sentry)
10. [ ] Launch! 🚀
