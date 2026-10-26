# 🚀 Quick Deploy Guide

## Prerequisites
✅ AWS CLI installed  
✅ SAM CLI installed  
⏳ AWS credentials needed

---

## Step 1: Configure AWS Credentials

Open PowerShell and run:

```powershell
C:\Users\likit\AppData\Roaming\Python\Python312\Scripts\aws.exe configure
```

**Enter when prompted:**
- **AWS Access Key ID:** Your access key from IAM
- **AWS Secret Access Key:** Your secret key
- **Default region name:** `ap-south-1`
- **Default output format:** `json`

**Get credentials from:**
https://console.aws.amazon.com/iam/home#/security_credentials

---

## Step 2: Deploy Backend (2 minutes)

```powershell
cd D:\Buildex_AWS\backend
.\deploy-backend.ps1
```

This will:
1. Build all 7 Lambda functions
2. Deploy to AWS with your existing stack
3. Verify with health check

---

## Step 3: Deploy Website (10 minutes)

### Option A: AWS Console (Easiest)

1. Go to: https://console.aws.amazon.com/amplify
2. Click **New app** → **Host web app**
3. Select **Deploy without Git provider**
4. Upload `website` folder as ZIP
5. Configure:
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
6. Add environment variables:
   ```
   VITE_COGNITO_USER_POOL_ID=ap-south-1_DFJckvu7H
   VITE_COGNITO_CLIENT_ID=1t0auvpbcr0lb9eb5c3tdunog5
   VITE_COGNITO_DOMAIN=buildex-ide
   VITE_API_ENDPOINT=https://vrgr3ltxr2.execute-api.ap-south-1.amazonaws.com
   VITE_AWS_REGION=ap-south-1
   ```
7. Click **Save and deploy**

### Option B: Amplify CLI

```powershell
cd D:\Buildex_AWS\website
npm install -g @aws-amplify/cli
amplify init
amplify add hosting
amplify publish
```

---

## Step 4: Update Cognito (2 minutes)

After you get your Amplify URL (e.g., `https://main.d1234.amplifyapp.com`):

1. Go to: https://ap-south-1.console.aws.amazon.com/cognito
2. User Pools → `ap-south-1_DFJckvu7H`
3. App integration → App clients → `1t0auvpbcr0lb9eb5c3tdunog5`
4. Edit **Allowed callback URLs**, add:
   ```
   https://buildexide.dev/auth/callback
   https://main.d1234.amplifyapp.com/auth/callback
   http://localhost:3000/auth/callback
   ```
5. Save changes

---

## Step 5: Add Custom Domain (5 minutes)

In Amplify Console:
1. Domain management → **Add domain**
2. Enter: `buildexide.dev`
3. Follow DNS instructions
4. Wait 5-10 minutes for SSL certificate

---

## Step 6: Test Everything ✅

### Test 1: New User Gets 0 Credits
1. Open BuildeX desktop app or website
2. Sign up with new email
3. Check credit balance → Should show "0 Credits"

### Test 2: Insufficient Credits Error
1. Try to use AI chat with 0 credits
2. Should get error: "Insufficient credits"

### Test 3: Purchase & Use Credits
1. Go to Pricing page
2. Purchase Pro plan (₹649)
3. Complete payment
4. Should get 2,000 credits
5. Use AI chat → Credits should deduct

### Test 4: Credit Sync
1. Use credits on Device A
2. Login on Device B
3. Both should show same balance

---

## Troubleshooting

**AWS credentials error:**
```powershell
aws configure
# Re-enter your credentials
```

**SAM build fails:**
```powershell
cd backend
npm install
sam build
```

**Amplify build fails:**
- Check environment variables are set
- Verify Node.js version (need 18+)
- Check build logs in Amplify console

**Credits not deducting:**
- Check CloudWatch logs for Lambda errors
- Verify DynamoDB tables are accessible
- Check API Gateway endpoint is live

---

## What's Deployed

**Backend Changes:**
- ✅ Default credits: 500 → 0
- ✅ Credit deduction per AI request
- ✅ Insufficient credits error (HTTP 402)
- ✅ Real-time credit tracking
- ✅ Chat history logging

**Frontend Changes:**
- ✅ All AWS branding removed
- ✅ BuildeX logo and branding
- ✅ Professional UI polish
- ✅ Clean pricing page
- ✅ 0 credits shown for new users

---

## Support

**CloudWatch Logs:**
https://ap-south-1.console.aws.amazon.com/cloudwatch/home?region=ap-south-1#logsV2:log-groups

**Lambda Functions:**
https://ap-south-1.console.aws.amazon.com/lambda/home?region=ap-south-1

**API Gateway:**
https://ap-south-1.console.aws.amazon.com/apigateway/main/apis?region=ap-south-1

**DynamoDB Tables:**
https://ap-south-1.console.aws.amazon.com/dynamodbv2/home?region=ap-south-1#tables

---

## Estimated Timeline

- **AWS Credentials:** 2 minutes
- **Backend Deploy:** 2-5 minutes
- **Website Deploy:** 10-15 minutes
- **Cognito Update:** 2 minutes
- **Custom Domain:** 5-10 minutes
- **Testing:** 10 minutes

**Total:** ~30-45 minutes

---

**Ready to launch BuildeX! 🚀**
