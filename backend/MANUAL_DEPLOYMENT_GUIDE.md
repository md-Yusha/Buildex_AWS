# 🚀 Manual Backend Deployment Guide

Since AWS SAM CLI isn't installed, here's how to deploy your backend changes via the **AWS Console** (simplest and fastest):

---

## 📦 Files That Changed

These two Lambda functions need to be updated:

1. **BuildexAuthCallbackFunction** - Changed default credits from 500 → 0
2. **BuildexChatStreamFunction** - Added credit tracking and deduction

---

## 🔄 Option 1: AWS Console (Recommended - No CLI needed)

### **Step 1: Package the Functions**

Create ZIP files for each changed function:

#### **For AuthCallback:**

```powershell
cd D:\Buildex_AWS\backend

# Create a temporary folder
mkdir temp-authcallback
cd temp-authcallback

# Copy the handler
copy ..\src\handlers\authCallback.js .

# Copy services folder
xcopy ..\src\services services\ /E /I

# Copy package.json
copy ..\package.json .

# Copy node_modules (this will take a moment)
xcopy ..\node_modules node_modules\ /E /I

# Create ZIP
Compress-Archive -Path * -DestinationPath ..\authCallback.zip -Force

cd..
Remove-Item temp-authcallback -Recurse -Force

Write-Host "✅ Created authCallback.zip" -ForegroundColor Green
```

#### **For ChatStream:**

```powershell
cd D:\Buildex_AWS\backend

# Create a temporary folder
mkdir temp-chatstream
cd temp-chatstream

# Copy the handler
copy ..\src\handlers\chatStream.js .

# Copy services folder
xcopy ..\src\services services\ /E /I

# Copy package.json
copy ..\package.json .

# Copy node_modules
xcopy ..\node_modules node_modules\ /E /I

# Create ZIP
Compress-Archive -Path * -DestinationPath ..\chatStream.zip -Force

cd ..
Remove-Item temp-chatstream -Recurse -Force

Write-Host "✅ Created chatStream.zip" -ForegroundColor Green
```

---

### **Step 2: Upload to AWS Lambda**

#### **Update AuthCallback Function:**

1. Go to **AWS Lambda Console**: https://ap-south-1.console.aws.amazon.com/lambda/home?region=ap-south-1
2. Search for function: `buildex-backend-prod-BuildexAuthCallbackFunction`
3. Click on the function name
4. Scroll down to **Code source** section
5. Click **Upload from** → **`.zip file`**
6. Choose `authCallback.zip`
7. Click **Save**
8. Wait for upload to complete (may take 1-2 minutes)
9. You should see "Successfully updated the function BuildexAuthCallbackFunction"

#### **Update ChatStream Function:**

1. Still in AWS Lambda Console
2. Search for function: `buildex-backend-prod-BuildexChatStreamFunction`
3. Click on the function name
4. Scroll down to **Code source** section
5. Click **Upload from** → **`.zip file`**
6. Choose `chatStream.zip`
7. Click **Save**
8. Wait for upload to complete
9. You should see "Successfully updated the function BuildexChatStreamFunction"

---

### **Step 3: Verify Deployment**

Test the API to ensure changes are live:

```powershell
# Test health endpoint
curl https://vrgr3ltxr2.execute-api.ap-south-1.amazonaws.com/health

# Should return: {"ok":true,"message":"BuildeX API Gateway is live"}
```

Test credit system:
```powershell
# Create a new test user - should get 0 credits
# (Use the website or Desktop IDE to sign up)
```

---

## 🔄 Option 2: Install AWS SAM CLI (One-time setup)

If you want to use `sam deploy` in the future:

### **1. Install AWS CLI v2:**

```powershell
# Download installer
Invoke-WebRequest -Uri "https://awscli.amazonaws.com/AWSCLIV2.msi" -OutFile "$env:TEMP\AWSCLIV2.msi"

# Install
Start-Process msiexec.exe -ArgumentList "/i `"$env:TEMP\AWSCLIV2.msi`" /quiet /norestart" -Wait

# Verify (restart terminal first)
aws --version
```

### **2. Install AWS SAM CLI:**

```powershell
# Download installer
Invoke-WebRequest -Uri "https://github.com/aws/aws-sam-cli/releases/latest/download/AWS_SAM_CLI_64_PY3.msi" -OutFile "$env:TEMP\SAM_CLI.msi"

# Install
Start-Process msiexec.exe -ArgumentList "/i `"$env:TEMP\SAM_CLI.msi`" /quiet /norestart" -Wait

# Verify (restart terminal first)
sam --version
```

### **3. Deploy:**

```bash
cd backend
sam build
sam deploy
```

---

## ✅ What These Changes Do

### **AuthCallback Changes:**
- Line 104: `creditsTotal: 0` (was 500)
- Line 106: `creditsRemaining: 0` (was 500)
- Line 122: `userRecord.creditsTotal = 0` (was 500)
- Line 173: `creditsRemaining: userRecord.creditsRemaining ?? 0` (was 500)

**Result:** New users start with 0 credits instead of 500

### **ChatStream Changes:**
- Added credit validation before AI requests
- Added automatic credit deduction after successful requests
- Added "Insufficient credits" error (HTTP 402)
- Added model cost mapping (0.1 - 2.0 credits)
- Added chat history logging to BuildexChats table
- Added request count tracking

**Result:** Proper credit system with real-time tracking

---

## 🧪 Testing After Deployment

### **Test 1: New User Gets 0 Credits**
1. Open BuildeX Desktop IDE
2. Sign up with a new email
3. Check credits display
4. **Expected:** "0 / 0 Credits"

### **Test 2: Insufficient Credits Error**
1. Try to use AI chat with 0 credits
2. **Expected:** Error message "Insufficient credits. Please purchase more credits to continue."
3. **Expected:** HTTP 402 status code

### **Test 3: Credits Deduct After Purchase**
1. Purchase Pro Plan (₹649) on website
2. Get 2,000 credits
3. Use AI chat
4. **Expected:** Credits deduct (e.g., -0.3 for Qwen)
5. **Expected:** Real-time balance update

---

## 📋 Deployment Checklist

- [ ] Created `authCallback.zip`
- [ ] Created `chatStream.zip`
- [ ] Uploaded `authCallback.zip` to BuildexAuthCallbackFunction
- [ ] Uploaded `chatStream.zip` to BuildexChatStreamFunction
- [ ] Verified health endpoint responds
- [ ] Tested new user signup (0 credits)
- [ ] Tested insufficient credits error
- [ ] Tested credit deduction after purchase

---

## 🆘 Troubleshooting

### **"ZIP file too large"**
If the ZIP is > 50MB (due to node_modules):
1. Use S3 upload instead
2. Or install SAM CLI for proper packaging

### **"Function not found"**
The exact function names might be different. Check AWS Lambda Console for:
- Functions starting with `buildex-backend-prod-`
- Look for `AuthCallback` and `ChatStream` in the name

### **"Update failed"**
- Check CloudWatch Logs for errors
- Verify the ZIP contains all dependencies
- Ensure node_modules is included in the ZIP

---

## 🎯 Next Steps After Backend Deployment

1. ✅ Backend deployed
2. ⏭️ Deploy website with Amplify
3. ⏭️ Update Cognito callbacks
4. ⏭️ Test end-to-end flow
5. ⏭️ Go live! 🚀

---

*Run the PowerShell commands above to create the ZIP files, then upload them via AWS Console.*
