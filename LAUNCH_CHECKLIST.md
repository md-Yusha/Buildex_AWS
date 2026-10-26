# 🚀 BuildeX Launch Checklist

Use this as you deploy. Check off each item as you complete it.

---

## Phase 1: Backend ✅ COMPLETE

- [x] SAM build successful
- [x] SAM deploy to buildex-backend-prod
- [x] 7 Lambda functions deployed
- [x] API Gateway endpoint working
- [x] Health check passes
- [x] Credit system implemented
- [x] 0 credits default for new users
- [x] Credit deduction before API calls
- [x] Payment integration (₹649/₹1999)

**Backend Status:** ✅ Live in production
**API Endpoint:** https://vrgr3ltxr2.execute-api.ap-south-1.amazonaws.com

---

## Phase 2: Website Preparation ✅ COMPLETE

- [x] BuildeX branding applied
- [x] AWS references removed
- [x] API endpoint configured
- [x] Responsive design verified
- [x] Git repository initialized
- [x] Initial commit (13 files)
- [x] .gitignore configured
- [x] README.md added

**Website Status:** ✅ Ready for GitHub push

---

## Phase 3: GitHub Deployment ⏳ PENDING

### Step 1: Create GitHub Repository
- [ ] Visit https://github.com/new
- [ ] Repository name: `buildexide-website`
- [ ] Visibility: **Public** (required for free GitHub Pages)
- [ ] **Do NOT** initialize with README (we already have one)
- [ ] Click "Create repository"
- [ ] Copy repository URL: `https://github.com/YOUR-USERNAME/buildexide-website.git`

### Step 2: Push to GitHub
- [ ] Run: `.\push-to-github.ps1 -GitHubUsername "YOUR-USERNAME"`
  
  OR manually:
  ```powershell
  cd website
  git remote add origin https://github.com/YOUR-USERNAME/buildexide-website.git
  git branch -M main
  git push -u origin main
  ```

- [ ] Verify files on GitHub: `https://github.com/YOUR-USERNAME/buildexide-website`
- [ ] Confirm all 13 files are visible
- [ ] Check commit message: "Initial commit: BuildeX IDE website v1.0"

### Step 3: Enable GitHub Pages
- [ ] Go to repository Settings: `https://github.com/YOUR-USERNAME/buildexide-website/settings/pages`
- [ ] Under "Build and deployment":
  - Source: **Deploy from a branch**
  - Branch: **main**
  - Folder: **/ (root)**
- [ ] Click **Save**
- [ ] Wait 1-2 minutes for deployment
- [ ] GitHub shows: "Your site is live at https://YOUR-USERNAME.github.io/buildexide-website/"
- [ ] Visit temporary URL to verify site works

---

## Phase 4: Cloudflare + Custom Domain ⏳ PENDING

### Step 1: Configure Cloudflare DNS
- [ ] Login to Cloudflare dashboard
- [ ] Select domain: `buildexide.dev`
- [ ] Go to **DNS** → **Records**
- [ ] Click **Add record**
  - Type: `CNAME`
  - Name: `@` (or `buildexide.dev`)
  - Target: `YOUR-USERNAME.github.io`
  - Proxy status: **Proxied** ✅ (orange cloud icon)
  - TTL: Auto
- [ ] Click **Save**
- [ ] (Optional) Add www subdomain:
  - Type: `CNAME`
  - Name: `www`
  - Target: `YOUR-USERNAME.github.io`
  - Proxy: **Proxied** ✅

### Step 2: Cloudflare SSL/TLS Settings
- [ ] Go to **SSL/TLS** tab
- [ ] Encryption mode: **Full** (or Full strict)
- [ ] **Always Use HTTPS:** On ✅
- [ ] **Automatic HTTPS Rewrites:** On ✅

### Step 3: Set Custom Domain in GitHub
- [ ] Back in GitHub Pages settings
- [ ] Under "Custom domain", enter: `buildexide.dev`
- [ ] Click **Save**
- [ ] Wait for DNS check (2-10 minutes)
- [ ] Once verified, enable **Enforce HTTPS** ✅
- [ ] GitHub shows: "Your site is published at https://buildexide.dev"

### Step 4: Verify DNS Propagation
- [ ] Visit https://buildexide.dev (may take 5-10 min)
- [ ] Check HTTPS works (green padlock)
- [ ] Verify site loads correctly
- [ ] Test on mobile/different browser

---

## Phase 5: Update Cognito Callbacks ⏳ PENDING

### Update Allowed Callbacks
- [ ] Run this command (replace with actual domain if different):
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

### Verify Cognito Configuration
- [ ] Run verification command:
  ```powershell
  python -m awscli cognito-idp describe-user-pool-client `
    --user-pool-id ap-south-1_DFJckvu7H `
    --client-id 1t0auvpbcr0lb9eb5c3tdunog5 `
    --region ap-south-1 `
    --query 'UserPoolClient.CallbackURLs'
  ```
- [ ] Verify output includes `https://buildexide.dev/auth/callback`

---

## Phase 6: Testing ⏳ PENDING

### Website Testing
- [ ] Visit https://buildexide.dev
- [ ] Verify HTTPS (green padlock in browser)
- [ ] Check responsive design on mobile
- [ ] Click "Sign In" button
- [ ] Verify redirect to Cognito hosted UI
- [ ] Sign up as new user
- [ ] After login, verify redirect back to buildexide.dev
- [ ] Check user credits show as **0**
- [ ] Click "Upgrade" → Payment page loads
- [ ] Verify pricing: ₹649 (Start) and ₹1999 (Enterprise)

### Desktop App Testing
- [ ] Run: `.\launch-buildex.ps1`
- [ ] Verify BuildeX branding (not AWS)
- [ ] Sign in with same account
- [ ] Verify credits show as **0**
- [ ] Attempt AI chat → Should be blocked
- [ ] Error message shows "Insufficient credits"

### Payment Flow Testing
- [ ] On website, click "Purchase Credits"
- [ ] Select Start Plan (₹649 → 2000 credits)
- [ ] Complete payment via Razorpay test mode
- [ ] Verify credits updated to 2000
- [ ] Desktop app shows updated credits (may need refresh)

### AI Chat Testing (After Purchase)
- [ ] In desktop app, start new chat
- [ ] Select model: Haiku (0.5 credits per request)
- [ ] Send message: "Hello, how are you?"
- [ ] Verify response received
- [ ] Check credits deducted: 2000 → 1999.5
- [ ] Test different models (DeepSeek: 0.8, Sonnet: 2.0)
- [ ] Verify different costs deducted

### Cross-Platform Testing
- [ ] Sign in on website → Check credits
- [ ] Sign in on desktop app → Same credits displayed
- [ ] Use credits on desktop app
- [ ] Refresh website → Credits synced
- [ ] Logout on one platform
- [ ] Login on other platform → Session maintained

---

## Phase 7: Production Verification ⏳ PENDING

### Backend Health
- [ ] Run: `.\test-production.ps1`
- [ ] All health checks pass
- [ ] No error logs in CloudWatch

### Monitor CloudWatch Logs
- [ ] Visit: https://ap-south-1.console.aws.amazon.com/cloudwatch/home?region=ap-south-1#logsV2:log-groups
- [ ] Check Lambda logs for errors:
  - `/aws/lambda/buildex-backend-prod-BuildexAuthCallbackFunction`
  - `/aws/lambda/buildex-backend-prod-BuildexChatStreamFunction`
  - `/aws/lambda/buildex-backend-prod-BuildexPaymentFunction`
- [ ] No error patterns detected

### DynamoDB Verification
- [ ] Visit: https://ap-south-1.console.aws.amazon.com/dynamodbv2/home?region=ap-south-1#tables
- [ ] Check tables:
  - [ ] `buildex-users` has user records
  - [ ] `buildex-projects` stores projects
  - [ ] `buildex-user-progress` tracks usage
- [ ] Verify credit values are correct

### API Gateway Metrics
- [ ] Visit: https://ap-south-1.console.aws.amazon.com/apigateway/home?region=ap-south-1#/apis
- [ ] Select `buildex-backend-prod`
- [ ] Dashboard → View metrics:
  - [ ] Request count > 0
  - [ ] 4XX errors minimal
  - [ ] 5XX errors = 0
  - [ ] Latency < 1000ms

---

## Phase 8: Final Cleanup ⏳ PENDING

### Remove Test Data
- [ ] Clear test users from Cognito (if any)
- [ ] Clear test entries from DynamoDB (if any)
- [ ] Reset credit balances for testing accounts

### Documentation
- [ ] Update README with production URLs
- [ ] Document environment variables
- [ ] Create user guide
- [ ] Create admin guide

### Security Review
- [ ] Verify HTTPS enforced everywhere
- [ ] Check Cognito password policies
- [ ] Verify API rate limits configured
- [ ] Review IAM permissions (least privilege)
- [ ] Enable CloudWatch alarms

---

## Phase 9: Launch! 🚀

- [ ] Announce on social media
- [ ] Send to beta testers
- [ ] Monitor initial user feedback
- [ ] Watch CloudWatch for errors
- [ ] Prepare for traffic scaling

---

## 📊 Success Metrics

After launch, track:
- [ ] User signups in first 24h
- [ ] Credit purchases
- [ ] API request volume
- [ ] Error rates < 1%
- [ ] Average response time < 500ms
- [ ] User retention day 1, day 7, day 30

---

## 🆘 Rollback Plan (If Needed)

If critical issues arise:

1. **Disable website:** Set Cloudflare DNS to "DNS Only" (gray cloud)
2. **Revert Lambda code:** Deploy previous version via SAM
3. **Pause signups:** Disable Cognito self-registration
4. **Notify users:** Update website with maintenance message

---

## ✅ Quick Status Check

Run these commands anytime to verify status:

```powershell
# Backend health
.\test-production.ps1

# Website git status
cd website
git status
git log --oneline

# Check if deployed to GitHub
git remote -v

# View Lambda logs
python -m awscli logs tail /aws/lambda/buildex-backend-prod-BuildexChatStreamFunction --region ap-south-1

# Check Cognito config
python -m awscli cognito-idp describe-user-pool-client --user-pool-id ap-south-1_DFJckvu7H --client-id 1t0auvpbcr0lb9eb5c3tdunog5 --region ap-south-1
```

---

## 🎉 When Everything is Checked

**Congratulations! BuildeX IDE is live!** 🚀

Your users can now:
- Sign up at https://buildexide.dev
- Download the desktop app
- Purchase credits (₹649 or ₹1999)
- Use AI-powered code assistance
- Build projects in the cloud

**Remember:**
- Monitor CloudWatch daily for first week
- Respond to user feedback quickly
- Scale infrastructure as needed
- Keep this checklist for future deployments

---

**Current Progress:**
- Phase 1 (Backend): ✅ 100% Complete
- Phase 2 (Website Prep): ✅ 100% Complete
- Phase 3 (GitHub): ⏳ 0% (Ready to start!)
- Overall: **40% Complete**

**Next Action:** Run `.\push-to-github.ps1 -GitHubUsername "YOUR-USERNAME"`
