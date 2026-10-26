# 🚀 BuildeX Production Go-Live Guide

**Status:** Backend packages ready ✅ | Website deployment next ⏭️

---

## 📦 Backend Deployment (ZIP Upload)

Your Lambda deployment packages are ready:

```
✅ D:\Buildex_AWS\backend\authCallback.zip (5.35 MB)
✅ D:\Buildex_AWS\backend\chatStream.zip (5.34 MB)
```

### Quick Deploy to AWS Lambda

1. **Open AWS Lambda Console:**
   ```
   https://ap-south-1.console.aws.amazon.com/lambda/home?region=ap-south-1
   ```

2. **Deploy authCallback (0 credits default):**
   - Search: `buildex-backend-prod-BuildexAuthCallbackFunction`
   - Click function name
   - **Code source** → **Upload from** → **.zip file**
   - Select: `authCallback.zip`
   - Click **Save** (wait 1-2 min)

3. **Deploy chatStream (credit deduction):**
   - Search: `buildex-backend-prod-BuildexChatStreamFunction`
   - Click function name
   - **Code source** → **Upload from** → **.zip file**
   - Select: `chatStream.zip`
   - Click **Save** (wait 1-2 min)

4. **Verify it worked:**
   ```powershell
   curl https://vrgr3ltxr2.execute-api.ap-south-1.amazonaws.com/health
   ```
   Should return: `{"ok":true,"message":"BuildeX API Gateway is live"}`

---

## 🌐 Website Deployment (Amplify)

### Option A: AWS Amplify Console (Recommended)

1. **Go to Amplify Console:**
   ```
   https://console.aws.amazon.com/amplify/home?region=ap-south-1
   ```

2. **Create New App:**
   - Click **New app** → **Host web app**
   - Connect your GitHub repository
   - Select branch: `main`

3. **Build Settings:**
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
   ```

4. **Environment Variables:**
   ```
   VITE_COGNITO_USER_POOL_ID=ap-south-1_DFJckvu7H
   VITE_COGNITO_CLIENT_ID=1t0auvpbcr0lb9eb5c3tdunog5
   VITE_COGNITO_DOMAIN=buildex-ide
   VITE_API_ENDPOINT=https://vrgr3ltxr2.execute-api.ap-south-1.amazonaws.com
   VITE_AWS_REGION=ap-south-1
   ```

5. **Deploy** and get Amplify URL (e.g., `https://main.d1234abcd.amplifyapp.com`)

### Option B: Amplify CLI

```bash
cd website
amplify init
amplify add hosting
amplify publish
```

---

## 🔐 Update Cognito Callbacks

**After you have your Amplify URL:**

1. Go to **Cognito Console:**
   ```
   https://ap-south-1.console.aws.amazon.com/cognito/home?region=ap-south-1
   ```

2. **User Pools** → `ap-south-1_DFJckvu7H` → **App integration** → **App clients**

3. **Edit** client `1t0auvpbcr0lb9eb5c3tdunog5`

4. **Update Allowed callback URLs:**
   ```
   https://buildexide.dev/auth/callback
   https://main.d1234abcd.amplifyapp.com/auth/callback
   http://localhost:3000/auth/callback
   ```

5. **Save changes**

---

## 🎯 Add Custom Domain

**After website is deployed on Amplify:**

1. Amplify Console → **Domain management** → **Add domain**
2. Enter: `buildexide.dev`
3. Follow DNS setup instructions
4. Wait 5-10 minutes for SSL certificate

---

## ✅ Testing Checklist

### Test 1: New User Gets 0 Credits
```
1. Open BuildeX Desktop IDE or website
2. Sign up with new email
3. Verify: "0 / 0 Credits" shown
4. ✅ PASS: New users get 0 credits
```

### Test 2: Insufficient Credits Error
```
1. New account with 0 credits
2. Try to use AI chat
3. Should get: "Insufficient credits" error
4. ✅ PASS: Proper error handling
```

### Test 3: Purchase & Use Credits
```
1. Go to buildexide.dev → Pricing
2. Purchase Pro (₹649)
3. Complete Razorpay payment
4. Should get 2,000 credits
5. Use AI chat
6. Credits should deduct (e.g., -0.3 for Qwen)
7. ✅ PASS: Full payment flow working
```

### Test 4: Credit Sync
```
1. Device A: Login, use 100 credits
2. Device B: Login, check balance
3. Device A: Refresh page
4. All devices should show same balance
5. ✅ PASS: Real-time sync working
```

---

## 🎉 What's Live After Deployment

### Students See:
- ✅ Clean "BuildeX IDE" branding (no AWS)
- ✅ "0 credits" by default (pay-to-use model)
- ✅ Full-featured IDE with Monaco editor
- ✅ AI chat powered by Claude/Qwen/DeepSeek
- ✅ Real-time credit tracking
- ✅ Professional pricing page
- ✅ Simple Razorpay payment integration

### Under the Hood:
- ✅ Lambda functions (7 total, 2 updated)
- ✅ DynamoDB tables (6 tables)
- ✅ API Gateway endpoint
- ✅ Cognito authentication
- ✅ Razorpay payment processor
- ✅ Amplify hosting with CDN
- ✅ CloudFront cache
- ✅ Custom domain support

---

## 💰 Revenue Model

**Free Tier:**
- 0 credits included
- Full IDE features (editor, terminal, git)
- No AI access

**Pro Tier - ₹649:**
- 2,000 credits
- ~6,600 Qwen requests (0.3 each)
- Auto-renew option

**Enterprise - ₹1,999:**
- 10,000 credits
- ~5,000 Claude 3.5 requests (2.0 each)
- Priority support

---

## 📊 What to Monitor Post-Launch

**First Week:**
- New user signups
- Payment conversion rate
- API error rates
- Credit consumption patterns

**Dashboards:**
- CloudWatch Metrics (Lambda errors, duration)
- DynamoDB (read/write capacity)
- Amplify (build status, performance)
- Razorpay (payment success rate)

---

## 🚨 Rollback Plan

If something breaks:

1. **Lambda Issue:** Redeploy previous version from AWS Console
2. **Website Issue:** Amplify auto-reverts to previous commit
3. **Cognito Issue:** Restore callback URLs
4. **Payment Issue:** Switch Razorpay to test mode

---

## 📞 Support & Next Steps

**For Backend Issues:**
- Check CloudWatch Logs: https://ap-south-1.console.aws.amazon.com/cloudwatch
- Check Lambda error rates
- Verify DynamoDB connectivity

**For Website Issues:**
- Check Amplify build logs
- Verify environment variables
- Test authentication flow

**For Payment Issues:**
- Check Razorpay dashboard
- Verify webhook delivery
- Test with ₹1 payment

---

## 🎯 Success Criteria

You'll know it's working when:

1. ✅ Backend deployed successfully
2. ✅ Health endpoint responds
3. ✅ New users get 0 credits
4. ✅ Website loads on buildexide.dev
5. ✅ Login works via Cognito
6. ✅ Payment processing works
7. ✅ Credits deduct on AI requests
8. ✅ Credit balance syncs across devices

---

## 🚀 Timeline

- **Now:** Deploy backend Lambda functions
- **+5 min:** Deploy website to Amplify
- **+10 min:** Update Cognito callbacks
- **+5 min:** Point domain to Amplify
- **+30 min:** Test end-to-end
- **+60 min:** Go live! 🎉

---

**Ready to launch BuildeX to the world!** 🌟

---

*Generated: October 26, 2026 - 10:05 PM IST*  
*BuildeX v1.2.0 - Production Release*
