# CloudFront Manual Setup Guide

Since the AWS CLI CloudFront creation failed due to account verification, follow these manual steps in the AWS Console.

---

## Step 1: Contact AWS Support (Do This First)

1. Go to: https://console.aws.amazon.com/support/home#/
2. Create a new case
3. Select "Account and billing support"
4. Issue: "CloudFront account verification"
5. Include this error message:
   ```
   AccessDenied: Your account must be verified before you can add new CloudFront resources.
   ```
6. Wait for AWS Support to verify your account (usually 24-48 hours)

---

## Step 2: Create CloudFront Distribution (After Verification)

### Via AWS Console

1. **Navigate to CloudFront:**
   - Go to: https://console.aws.amazon.com/cloudfront/v3/home
   - Click "Create distribution"

2. **Origin Settings:**
   - **Origin domain:** `buildex-ide-web-052477895001.s3-website.ap-south-1.amazonaws.com`
   - **Protocol:** HTTP only (S3 website endpoints don't support HTTPS)
   - **Name:** Leave as default or enter "BuildeX-S3-Website"

3. **Default Cache Behavior:**
   - **Viewer protocol policy:** Redirect HTTP to HTTPS ✅
   - **Allowed HTTP methods:** GET, HEAD
   - **Compress objects automatically:** Yes ✅

4. **Settings:**
   - **Price class:** Use all edge locations (best performance)
   - **Alternate domain name (CNAME):** (leave empty for now, or add `buildexide.dev` if you have it)
   - **Custom SSL certificate:** (leave default for now, or request ACM certificate for buildexide.dev)
   - **Default root object:** `index.html`

5. **Custom Error Pages:**
   - Click "Add custom error response"
   - **HTTP error code:** 404
   - **Customize error response:** Yes
   - **Response page path:** `/index.html`
   - **HTTP response code:** 200

6. **Create Distribution**
   - Click "Create distribution"
   - Wait 10-15 minutes for deployment

7. **Copy CloudFront Domain:**
   - After creation, note the domain name (e.g., `d1a2b3c4d5e6f7.cloudfront.net`)

---

## Step 3: Update Cognito Callbacks

Once CloudFront is deployed and you have the HTTPS URL:

```powershell
# Replace YOUR-CLOUDFRONT-DOMAIN with actual domain
$cloudfrontDomain = "d1a2b3c4d5e6f7.cloudfront.net"  # Your actual domain here
$userPoolId = "ap-south-1_DFJckvu7H"
$clientId = "1t0auvpbcr0lb9eb5c3tdunog5"

python -m awscli cognito-idp update-user-pool-client `
  --user-pool-id $userPoolId `
  --client-id $clientId `
  --callback-urls "https://$cloudfrontDomain/auth/callback" "buildexcoder://auth/callback" `
  --logout-urls "https://$cloudfrontDomain" "buildexcoder://logout" `
  --allowed-o-auth-flows "code" `
  --allowed-o-auth-scopes "email" "openid" "profile" `
  --allowed-o-auth-flows-user-pool-client `
  --supported-identity-providers "COGNITO" `
  --region ap-south-1
```

---

## Step 4: Test Website Login

1. Open: `https://YOUR-CLOUDFRONT-DOMAIN`
2. Click "Sign In"
3. Verify redirect to Cognito hosted UI
4. After login, verify redirect back to your CloudFront URL
5. Check that credits show as 0 for new users

---

## Step 5: (Optional) Add Custom Domain

If you own `buildexide.dev`:

### 5.1 Request SSL Certificate
1. Go to: https://console.aws.amazon.com/acm/home?region=us-east-1#/
   - **IMPORTANT:** Must be in `us-east-1` region for CloudFront
2. Request public certificate
3. Domain name: `buildexide.dev` and `*.buildexide.dev`
4. Validation method: DNS validation
5. Add CNAME records to your domain registrar (Namecheap, GoDaddy, etc.)
6. Wait for certificate validation (5-30 minutes)

### 5.2 Update CloudFront Distribution
1. Go to CloudFront distribution settings
2. Edit settings:
   - **Alternate domain names:** `buildexide.dev`
   - **Custom SSL certificate:** Select your ACM certificate
3. Save changes

### 5.3 Update DNS
In your domain registrar (e.g., GoDaddy, Namecheap):
```
Type: CNAME
Name: buildexide.dev (or @ for root)
Value: d1a2b3c4d5e6f7.cloudfront.net (your CloudFront domain)
TTL: 300
```

### 5.4 Update Cognito Again
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

## Verification Checklist

- [ ] AWS Support verified account for CloudFront
- [ ] CloudFront distribution created
- [ ] Distribution status: "Deployed"
- [ ] HTTPS URL working: `https://YOUR-CLOUDFRONT-DOMAIN`
- [ ] Cognito callbacks updated with HTTPS URL
- [ ] Website login/logout working
- [ ] Credits show as 0 for new users
- [ ] (Optional) Custom domain `buildexide.dev` pointing to CloudFront
- [ ] (Optional) SSL certificate validated and attached

---

## Current Status

✅ **Backend:** Fully deployed and working
✅ **Desktop App:** Ready for production use
✅ **Website Files:** Uploaded to S3
⏳ **CloudFront:** Waiting for account verification
⏳ **HTTPS Access:** Pending CloudFront setup

---

## Quick Reference

### S3 Bucket
- Name: `buildex-ide-web-052477895001`
- Region: `ap-south-1`
- HTTP URL: http://buildex-ide-web-052477895001.s3-website.ap-south-1.amazonaws.com

### Cognito
- User Pool ID: `ap-south-1_DFJckvu7H`
- Client ID: `1t0auvpbcr0lb9eb5c3tdunog5`
- Domain: `buildex-ide.auth.ap-south-1.amazoncognito.com`

### API Gateway
- Endpoint: `https://vrgr3ltxr2.execute-api.ap-south-1.amazonaws.com`

### Payment Plans
- Start Plan: ₹649 → 2000 credits
- Enterprise Plan: ₹1999 → 10000 credits
