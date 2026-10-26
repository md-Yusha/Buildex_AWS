# 🚀 BuildeX IDE - Deploy to buildexide.dev

## Quick Start (5 minutes)

### 1. Push to GitHub
```powershell
.\push-to-github.ps1 -GitHubUsername "YOUR-GITHUB-USERNAME"
```

**Don't have the repo yet?** Create it first: https://github.com/new
- Name: `buildexide-website`
- Visibility: **Public**
- ❌ Don't initialize with README/license

---

### 2. Enable GitHub Pages
1. Visit: `https://github.com/YOUR-USERNAME/buildexide-website/settings/pages`
2. Source: **Deploy from a branch**
3. Branch: **main** → Folder: **/ (root)**
4. Click **Save**
5. ⏳ Wait 1-2 minutes

---

### 3. Configure Cloudflare DNS
1. Login to Cloudflare → Select `buildexide.dev`
2. Go to **DNS** → **Records**
3. **Add CNAME record:**
   ```
   Type:    CNAME
   Name:    @
   Target:  YOUR-USERNAME.github.io
   Proxy:   ✅ Proxied (orange cloud)
   ```
4. Save

---

### 4. Set Custom Domain in GitHub
1. Back in GitHub Pages settings
2. Custom domain: `buildexide.dev`
3. Click **Save**
4. ⏳ Wait for DNS check (2-5 min)
5. Enable **Enforce HTTPS** ✅

---

### 5. Update Cognito Callbacks
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

### 6. Test Live Site
Visit: **https://buildexide.dev**

Test checklist:
- [ ] Site loads with HTTPS ✅
- [ ] Click "Sign In" → Cognito redirect works
- [ ] After login → Returns to buildexide.dev
- [ ] New user sees 0 credits
- [ ] Payment plans displayed: ₹649 and ₹1999

---

## ✅ Current Status

- ✅ **Backend deployed** to AWS Lambda
- ✅ **Website ready** in git (13 files committed)
- ✅ **API configured** for production
- ⏳ **Waiting:** Push to GitHub + Cloudflare setup

---

## 🆘 Need Help?

**Detailed guides:**
- [GITHUB_CLOUDFLARE_DEPLOY.md](GITHUB_CLOUDFLARE_DEPLOY.md) - Step-by-step with screenshots
- [FINAL_DEPLOYMENT_SUMMARY.md](FINAL_DEPLOYMENT_SUMMARY.md) - Complete project status
- [DEPLOYMENT_STATUS.md](DEPLOYMENT_STATUS.md) - Technical details

**Quick tests:**
```powershell
# Test backend
.\test-production.ps1

# Launch desktop app
.\launch-buildex.ps1

# View commit history
cd website
git log --oneline
```

---

## 🎉 After Launch

Your website will be live at:
- **Primary:** https://buildexide.dev (via Cloudflare)
- **Fallback:** https://YOUR-USERNAME.github.io/buildexide-website/

**To update in future:**
```powershell
cd website
# Make changes...
git add .
git commit -m "Update: description"
git push origin main
# Site updates automatically in 1-2 min!
```

---

## Ready? Let's Go! 🚀

Run this now:
```powershell
.\push-to-github.ps1 -GitHubUsername "YOUR-USERNAME"
```
