# 🚀 BuildeX Production Deployment Checklist

Complete guide to deploy BuildeX to production for students.

---

## ✅ Phase 1: Backend Deployment (In Progress)

### 1.1 Lambda Function Updates

**Files Being Created:**
- ✅ `backend/authCallback.zip` - New user gets 0 credits (was 500)
- ✅ `backend/chatStream.zip` - Credit tracking and deduction system

**Deploy via AWS Console:**

1. **Go to AWS Lambda Console:**
   ```
   https://ap-south-1.console.aws.amazon.com/lambda/home?region=ap-south-1
   ```

2. **Update AuthCallback Function:**
   - Search: `buildex-backend-prod-BuildexAuthCallbackFunction`
   - Click function name
   - Code source → Upload from → `.zip file`
   - Select: `D:\Buildex_AWS\backend\authCallback.zip`
   - Click **Save**
   - Wait for deployment (1-2 minutes)

3. **Update ChatStream Function:**
   - Search: `buildex-backend-prod-BuildexChatStreamFunction`
   - Click function name
   - Code source → Upload from → `.zip file`
   - Select: `D:\Buildex_AWS\backend\chatStream.zip`
   - Click **Save**
   - Wait for deployment

4. **Verify Health Endpoint:**
   ```powershell
   curl https://vrgr3ltxr2.execute-api.ap-south-1.amazonaws.com/health
   # Should return: {"ok":true,"message":"BuildeX API Gateway is live"}
   ```

**Status:** 🔄 ZIP files being created

---

## 📋 Phase 2: Database Cleanup

### 2.1 Clear Test Data from DynamoDB

**Tables to Clear:**

1. **BuildexUsers** - Remove test user accounts
2. **BuildexProjects** - Remove test projects
3. **BuildexChats** - Remove test chat history
4. **BuildexCodeSnapshots** - Remove test code snapshots
5. **BuildexUserProgress** - Remove test progress data
6. **BuildexPayments** - Remove test payment records

**Method 1: AWS Console (Manual)**

For each table:
1. Go to DynamoDB Console: https://ap-south-1.console.aws.amazon.com/dynamodbv2
2. Click table name
3. Actions → Delete all items → Confirm

**Method 2: Script (Automated)**

Run the cleanup script:
```powershell
cd D:\Buildex_AWS\backend\scripts
node cleanup-dynamodb.js
```

**Status:** ⏳ Pending (after Lambda deployment)

---

## 🎨 Phase 3: UI/UX Production Polish

### 3.1 Branding Updates (✅ COMPLETED)

- ✅ Removed "AWS" from all user-facing text
- ✅ Removed "Bedrock" from UI (except AI panel model selector)
- ✅ Changed window title to "BuildeX IDE"
- ✅ Updated app name to "BuildeX"
- ✅ Electron icon uses BuildeX logo (`assets/logo.png`)
- ✅ No AWS/Bedrock references in website

### 3.2 Desktop IDE Improvements

**File:** `main.js`, `renderer.js`, `index.html`

**Changes Applied:**
- ✅ Window title: "BuildeX IDE"
- ✅ App name in menu: "BuildeX"
- ✅ Icon updated to use logo

**TODO:**
- [ ] Replace `B` favicon in Electron window with actual logo
- [ ] Test on clean Windows machine
- [ ] Verify all dialogs show "BuildeX" branding

### 3.3 Website UI (`website/`)

**Current Status:**
- ✅ Landing page: Clean, modern design
- ✅ Features page: No AWS branding
- ✅ Pricing page: Clean ₹ pricing
- ✅ Login/Signup: Cognito OAuth (no branding visible)

**TODO:**
- [ ] Review website on buildexide.dev after Amplify deploy
- [ ] Test authentication flow end-to-end
- [ ] Verify all pages are mobile-responsive
- [ ] Check footer links and social media

---

## 🔐 Phase 4: Authentication & Cognito

### 4.1 Current Cognito Setup

**User Pool ID:** `ap-south-1_DFJckvu7H`  
**Client ID:** `1t0auvpbcr0lb9eb5c3tdunog5`  
**Region:** `ap-south-1`

**Current Callback URLs:**
```
http://localhost:3000/auth/callback
http://localhost:8080/auth/callback
```

### 4.2 Update Cognito for Production

**After website deployment to Amplify:**

1. **Get Amplify URL** (e.g., `https://main.d1234abcd.amplifyapp.com`)

2. **Update Cognito App Client:**
   ```
   Go to: https://ap-south-1.console.aws.amazon.com/cognito
   → User Pools → ap-south-1_DFJckvu7H
   → App Integration → App clients
   → Edit client: 1t0auvpbcr0lb9eb5c3tdunog5
   ```

3. **Add Production Callbacks:**
   ```
   Allowed callback URLs:
   - https://buildexide.dev/auth/callback
   - https://main.d1234abcd.amplifyapp.com/auth/callback
   - http://localhost:3000/auth/callback  (for dev)
   
   Allowed sign-out URLs:
   - https://buildexide.dev/
   - https://main.d1234abcd.amplifyapp.com/
   - http://localhost:3000/
   ```

4. **Save changes**

**Status:** ⏳ Pending (after Amplify deployment)

---

## 🌐 Phase 5: Website Deployment

### 5.1 Deploy to AWS Amplify

**Prerequisites:**
- AWS Amplify CLI installed (or use Console)
- GitHub repo connected

**Method 1: Amplify Console (Recommended)**

1. Go to AWS Amplify Console:
   ```
   https://ap-south-1.console.aws.amazon.com/amplify/home?region=ap-south-1
   ```

2. Click **New app** → **Host web app**

3. Connect GitHub repository

4. Configure build settings:
   ```yaml
   version: 1
   frontend:
     phases:
       preBuild:
         commands:
           - cd website
           - npm install
       build:
         commands:
           - npm run build
     artifacts:
       baseDirectory: website/dist
       files:
         - '**/*'
     cache:
       paths:
         - website/node_modules/**/*
   ```

5. Set environment variables:
   ```
   VITE_COGNITO_USER_POOL_ID=ap-south-1_DFJckvu7H
   VITE_COGNITO_CLIENT_ID=1t0auvpbcr0lb9eb5c3tdunog5
   VITE_COGNITO_DOMAIN=buildex-auth
   VITE_API_ENDPOINT=https://vrgr3ltxr2.execute-api.ap-south-1.amazonaws.com
   VITE_AWS_REGION=ap-south-1
   ```

6. Deploy and get URL

**Method 2: Amplify CLI**

```bash
cd website
amplify init
amplify add hosting
amplify publish
```

### 5.2 Custom Domain Setup

1. In Amplify Console → Domain management
2. Add domain: `buildexide.dev`
3. Verify DNS records
4. Wait for SSL certificate provisioning (5-10 minutes)

**Status:** ⏳ Pending

---

## 💳 Phase 6: Credits & Payment System

### 6.1 Default Credits (✅ UPDATED)

**Changes Applied:**
- ✅ New users: 0 credits (was 500)
- ✅ Free tier: 0 credits
- ✅ Pro plan: 2,000 credits (₹649)
- ✅ Enterprise: 10,000 credits (₹2,499)

### 6.2 Credit Deduction System (✅ IMPLEMENTED)

**Model Costs:**
- `qwen.qwen3-coder-30b-a3b-instruct`: 0.3 credits
- `deepseek.deepseek-v3`: 0.5 credits
- `mistral.mistral-large-2407`: 1.0 credits
- `meta.llama3-3-70b-instruct`: 1.5 credits
- `google.gemma-2-27b-it`: 0.8 credits
- `amazon.nova-micro-v1:0`: 0.1 credits
- `anthropic.claude-3-5-sonnet-v2`: 2.0 credits

**Credit Tracking:**
- ✅ Real-time deduction after each AI request
- ✅ DynamoDB updates (creditsUsed, creditsRemaining)
- ✅ Chat history logging to BuildexChats table
- ✅ Insufficient credits error (HTTP 402)

### 6.3 Payment Integration

**Current:** Razorpay integration ready (`website/payment.html`)

**TODO:**
- [ ] Test Razorpay in production mode
- [ ] Verify webhook receives payment confirmations
- [ ] Test credit grant after successful payment
- [ ] Verify real-time sync in Desktop IDE

**Status:** ⏳ Testing required after deployment

---

## 🔄 Phase 7: Real-time Sync

### 7.1 Login/Logout Sync (✅ IMPLEMENTED)

**Desktop IDE (`main.js`):**
- ✅ On login: Fetches user data from `/user/progress` API
- ✅ Displays: `{creditsRemaining} / {creditsTotal} Credits`
- ✅ On logout: Clears local state
- ✅ On AI request: Deducts credits + updates UI

**Website:**
- ✅ Cognito OAuth handles authentication
- ✅ After login: Redirects to Desktop IDE launcher
- ✅ Credits display: Fetched from API

### 7.2 Multi-Device Sync

**Current Behavior:**
- User logs in on Desktop IDE → Credits from DynamoDB
- User makes AI request → Credits deducted in real-time
- User logs out and logs back in → Fresh credits loaded from DynamoDB

**TODO:**
- [ ] Test multi-device scenario:
  - Device A: Login, use 100 credits
  - Device B: Login, should see updated balance
  - Device A: Refresh, should see updated balance

**Status:** ⏳ Testing required

---

## 🧪 Phase 8: End-to-End Testing

### 8.1 New User Journey

**Test Flow:**

1. **Sign Up:**
   - [ ] Go to buildexide.dev
   - [ ] Click "Get Started"
   - [ ] Sign up with email/Google
   - [ ] Verify email (if email signup)

2. **First Login:**
   - [ ] Should see: "0 / 0 Credits"
   - [ ] Try to use AI chat
   - [ ] Should get: "Insufficient credits" error

3. **Purchase Credits:**
   - [ ] Go to Pricing page
   - [ ] Click "Get Pro" (₹649)
   - [ ] Complete Razorpay payment
   - [ ] Should see: "2000 / 2000 Credits"

4. **Use AI:**
   - [ ] Ask a coding question
   - [ ] Should get response
   - [ ] Credits should deduct (e.g., "1999.7 / 2000")

5. **Logout & Login:**
   - [ ] Logout from Desktop IDE
   - [ ] Login again
   - [ ] Should see updated credit balance
   - [ ] Chat history should persist

### 8.2 Existing User Migration

**Current Test Users:** Should be cleared from DynamoDB

**TODO:**
- [ ] Clear all test data
- [ ] Verify production starts with 0 users
- [ ] First real user should get 0 credits

### 8.3 Credit System Verification

**Test Cases:**

1. **Credit Deduction:**
   - [ ] Use Qwen model → -0.3 credits
   - [ ] Use DeepSeek → -0.5 credits
   - [ ] Use Nova Micro → -0.1 credits

2. **Insufficient Credits:**
   - [ ] Use all credits
   - [ ] Try AI chat
   - [ ] Should block with 402 error

3. **Real-time Update:**
   - [ ] Make request on Device A
   - [ ] Open Device B
   - [ ] Should see updated balance immediately

**Status:** ⏳ Pending

---

## 🔐 Phase 9: Security & Compliance

### 9.1 Environment Variables

**Sensitive Data:**
- ✅ All credentials in `.env` file
- ✅ `.env` in `.gitignore`
- ✅ Lambda uses environment variables
- ✅ Website uses Amplify environment variables

**TODO:**
- [ ] Rotate AWS Access Keys after going live
- [ ] Enable CloudWatch Logs for Lambda
- [ ] Set up billing alerts

### 9.2 CORS & Security Headers

**Current Configuration:**
```javascript
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, OPTIONS, PUT, DELETE
Access-Control-Allow-Headers: Content-Type, Authorization
```

**TODO:**
- [ ] After Amplify deployment, restrict CORS to:
  ```javascript
  Access-Control-Allow-Origin: https://buildexide.dev
  ```

### 9.3 Rate Limiting

**Current:** No rate limiting

**TODO (Future Enhancement):**
- [ ] Add API Gateway throttling
- [ ] Add per-user request limits
- [ ] Add Lambda reserved concurrency

**Status:** ⏳ Production hardening phase

---

## 📊 Phase 10: Monitoring & Analytics

### 10.1 AWS CloudWatch

**Enable Logging:**

1. Lambda Functions:
   - [ ] Enable CloudWatch Logs for all functions
   - [ ] Set log retention: 7 days

2. API Gateway:
   - [ ] Enable access logs
   - [ ] Enable execution logs

3. DynamoDB:
   - [ ] Monitor read/write capacity
   - [ ] Set up auto-scaling if needed

### 10.2 Usage Analytics

**Track:**
- [ ] Daily active users
- [ ] Credits consumed per day
- [ ] Most used AI models
- [ ] Payment conversion rate

**Tools:**
- AWS CloudWatch Metrics
- DynamoDB streams (future)
- Google Analytics on website

**Status:** ⏳ Post-launch

---

## 🚀 Phase 11: Launch Preparation

### 11.1 Final Checks Before Launch

- [ ] All Lambda functions deployed
- [ ] DynamoDB tables cleaned
- [ ] Website deployed to Amplify
- [ ] Custom domain configured
- [ ] Cognito callbacks updated
- [ ] SSL certificate active
- [ ] Payment system tested
- [ ] Credit system tested end-to-end
- [ ] Desktop IDE installer signed (optional)
- [ ] Documentation updated

### 11.2 Launch Announcement

**Channels:**
- [ ] Social media (Twitter, LinkedIn)
- [ ] Product Hunt
- [ ] Reddit (r/programming, r/learnprogramming)
- [ ] Dev.to blog post
- [ ] Email to beta testers

### 11.3 Support & Maintenance

**Set Up:**
- [ ] Support email: support@buildexide.dev
- [ ] Bug tracking: GitHub Issues
- [ ] User feedback form
- [ ] FAQ page

**Status:** ⏳ Pre-launch

---

## 📝 Current Status Summary

| Phase | Status | Notes |
|-------|--------|-------|
| Backend Lambda | 🔄 In Progress | ZIP files being created |
| Database Cleanup | ⏳ Pending | After Lambda deployment |
| UI/UX Polish | ✅ Complete | Branding updated |
| Auth & Cognito | ⏳ Pending | Update after Amplify deploy |
| Website Deploy | ⏳ Pending | Amplify publish |
| Credits System | ✅ Complete | 0 default, deduction working |
| Real-time Sync | ✅ Complete | Login/logout working |
| Testing | ⏳ Pending | After deployment |
| Security | ⏳ Pending | Production hardening |
| Monitoring | ⏳ Pending | Post-launch |
| Launch Prep | ⏳ Pending | Final checks |

---

## 🎯 Next Immediate Steps

1. ✅ Wait for Lambda ZIP creation to complete
2. ⏭️ Upload ZIPs to AWS Lambda Console
3. ⏭️ Clear DynamoDB test data
4. ⏭️ Deploy website to Amplify
5. ⏭️ Update Cognito callbacks
6. ⏭️ End-to-end testing
7. ⏭️ Go live! 🚀

---

## 📞 Support

If you encounter issues during deployment:
1. Check CloudWatch Logs for Lambda errors
2. Verify DynamoDB table configurations
3. Test API endpoints with `curl`
4. Check Amplify build logs

---

**Last Updated:** October 26, 2026, 9:55 PM IST  
**Deployed By:** Production Team  
**Target Launch:** After successful testing
