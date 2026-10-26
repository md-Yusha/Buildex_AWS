# 🚀 BuildeX Developer Quick Start Guide

## 📦 Prerequisites

- **Node.js** 18.x or higher
- **AWS CLI** configured with credentials
- **AWS SAM CLI** (for backend deployment)
- **Git** for version control
- **Code Editor** (VS Code recommended)

---

## ⚡ Quick Setup (5 Minutes)

### 1. Clone & Install Dependencies

```bash
# Clone repository
git clone https://github.com/md-Yusha/Buildex_AWS.git
cd Buildex_AWS

# Install desktop IDE dependencies
npm install

# Install backend dependencies
cd backend
npm install
cd ..
```

### 2. Configure Environment Variables

Create a `.env` file in the project root:

```bash
# Copy from example
cp .env.example .env

# Edit .env with your AWS credentials
nano .env  # or use your preferred editor
```

**Minimum Required Variables:**
```env
AWS_REGION=ap-south-1
AWS_ACCESS_KEY_ID=your_key_here
AWS_SECRET_ACCESS_KEY=your_secret_here

BUILDEX_API_BASE_URL=https://vrgr3ltxr2.execute-api.ap-south-1.amazonaws.com
COGNITO_USER_POOL_ID=ap-south-1_DFJckvu7H
COGNITO_CLIENT_ID=1t0auvpbcr0lb9eb5c3tdunog5
```

### 3. Run Desktop IDE

```bash
npm start
```

The BuildeX IDE window will open automatically.

---

## 🔨 Development Workflows

### **Desktop IDE Development**

```bash
# Run in development mode with hot reload
npm start

# Build Windows installer (.exe)
npm run build:win

# Build macOS app (.dmg)
npm run build:mac

# Build all platforms
npm run build:all
```

**File Structure:**
- `main.js` - Electron main process (Node.js APIs)
- `renderer.js` - IDE UI logic (Monaco, Terminal, AI Chat)
- `preload.js` - IPC bridge between main and renderer
- `index.html` - Desktop IDE HTML structure
- `styles.css` - Desktop IDE styling

### **Backend (AWS Lambda) Development**

```bash
cd backend

# Install dependencies
npm install

# Build Lambda functions
sam build

# Test locally with SAM Local
sam local start-api --port 3001

# Deploy to AWS
sam deploy --guided

# Or deploy with existing config
sam deploy
```

**File Structure:**
- `template.yaml` - AWS SAM CloudFormation template
- `src/handlers/` - Lambda function handlers
- `src/services/` - Reusable service clients (Bedrock, DynamoDB, S3)

### **Website Development**

```bash
cd website

# No build step needed - pure HTML/JS/CSS
# Open index.html in browser or serve locally

# Deploy to S3 (example)
aws s3 sync . s3://your-bucket-name --exclude "*.sh" --exclude "version.json"
```

---

## 🧪 Testing & Debugging

### **Test Desktop IDE**

```bash
# Open DevTools in Electron
# Add to main.js:
mainWindow.webContents.openDevTools();

# Check logs
console.log() statements appear in DevTools Console

# Check IPC messages
// In renderer.js
window.api.onLog((msg) => console.log('IPC:', msg));
```

### **Test Backend APIs**

```bash
# Health check
curl https://vrgr3ltxr2.execute-api.ap-south-1.amazonaws.com/api/health

# Test Bedrock chat
curl -X POST https://vrgr3ltxr2.execute-api.ap-south-1.amazonaws.com/api/chat/stream \
  -H "Content-Type: application/json" \
  -d '{
    "mode": "learn",
    "prompt": "What is recursion?",
    "codeContext": "",
    "activeFile": ""
  }'

# Test user progress
curl "https://vrgr3ltxr2.execute-api.ap-south-1.amazonaws.com/api/user/progress?userId=test_user"

# Test S3 pre-signed URL
curl -X POST https://vrgr3ltxr2.execute-api.ap-south-1.amazonaws.com/api/projects/presigned-url \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "test_user",
    "filename": "project.zip"
  }'
```

### **Test Authentication**

```bash
# Initiate auth session
curl -X POST https://vrgr3ltxr2.execute-api.ap-south-1.amazonaws.com/api/auth/session \
  -H "Content-Type: application/json" \
  -d '{}'

# Returns: {"authSessionId": "sess_abc123", "authUrl": "https://..."}

# Poll session status
curl "https://vrgr3ltxr2.execute-api.ap-south-1.amazonaws.com/api/auth/session?id=sess_abc123"
```

---

## 📝 Common Tasks

### **Add a New Lambda Handler**

1. Create handler file in `backend/src/handlers/`:
```javascript
// backend/src/handlers/myNewHandler.js
export async function handler(event) {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify({ message: 'Hello from new handler!' })
  };
}
```

2. Add to `backend/template.yaml`:
```yaml
MyNewFunction:
  Type: AWS::Serverless::Function
  Properties:
    CodeUri: ./
    Handler: src/handlers/myNewHandler.handler
    Events:
      MyNewApi:
        Type: HttpApi
        Properties:
          ApiId: !Ref BuildexHttpApi
          Path: /api/my-new-endpoint
          Method: GET
```

3. Deploy:
```bash
cd backend
sam build && sam deploy
```

### **Add a New AI Mode**

1. Add system prompt to `src/ai/bedrockClient.js`:
```javascript
const SYSTEM_PROMPTS = {
  learn: `...`,
  explain: `...`,
  debug: `...`,
  agent: `...`,
  myNewMode: `You are BuildeX [mode name]. [Instructions...]`
};
```

2. Update renderer UI to include mode selector button in `renderer.js`

3. Test with:
```javascript
window.api.chatStream({
  messages: [{ role: 'user', content: 'Test prompt' }],
  mode: 'myNewMode',
  model: 'qwen.qwen3-coder-30b-a3b-instruct'
});
```

### **Add a New DynamoDB Table**

1. Add to `backend/template.yaml`:
```yaml
Parameters:
  MyNewTableName:
    Type: String
    Default: BuildexMyNewTable

Globals:
  Function:
    Environment:
      Variables:
        MY_NEW_TABLE: !Ref MyNewTableName
```

2. Add to `backend/src/services/dynamo.js`:
```javascript
export const TABLES = {
  USERS: process.env.USERS_TABLE || "BuildexUsers",
  // ... other tables
  MY_NEW_TABLE: process.env.MY_NEW_TABLE || "BuildexMyNewTable"
};
```

3. Use in handlers:
```javascript
import { docClient, TABLES } from "../services/dynamo.js";
import { PutCommand, GetCommand } from "@aws-sdk/lib-dynamodb";

await docClient.send(new PutCommand({
  TableName: TABLES.MY_NEW_TABLE,
  Item: { id: '123', data: 'value' }
}));
```

4. Create table manually in AWS Console or add to SAM template

---

## 🐛 Common Issues & Solutions

### **Issue: "Cannot find module '@aws-sdk/...'"**

```bash
# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install
```

### **Issue: Electron app won't start**

```bash
# Check Node.js version
node --version  # Should be 18.x or higher

# Clear Electron cache
rm -rf ~/.electron

# Reinstall Electron
npm install electron --save-dev
```

### **Issue: SAM deployment fails**

```bash
# Check AWS credentials
aws sts get-caller-identity

# Rebuild and deploy
cd backend
sam build --use-container
sam deploy --guided
```

### **Issue: Bedrock "AccessDeniedException"**

1. Go to [AWS Bedrock Console](https://console.aws.amazon.com/bedrock/)
2. Click **Model Access** in left sidebar
3. Click **Modify model access**
4. Enable required models (Claude, Nova, Qwen, etc.)
5. Submit request and wait for approval (usually instant)

### **Issue: Cognito authentication fails**

1. Verify callback URL in Cognito User Pool settings:
   - Go to User Pool → App Integration → App Client
   - Ensure callback URL matches: `https://vrgr3ltxr2.execute-api.ap-south-1.amazonaws.com/api/auth/callback`

2. Check environment variables:
   - `COGNITO_CLIENT_ID` matches app client ID
   - `COGNITO_USER_POOL_ID` matches pool ID
   - `COGNITO_DOMAIN_PREFIX` matches domain prefix

---

## 📊 Monitoring & Logs

### **View Lambda Logs**

```bash
# Install AWS SAM CLI
# View live logs
sam logs -n ChatStreamFunction --stack-name buildex-backend-prod --tail

# Or use AWS CloudWatch
aws logs tail /aws/lambda/buildex-backend-prod-ChatStreamFunction --follow
```

### **View DynamoDB Data**

```bash
# List all users
aws dynamodb scan --table-name BuildexUsers --region ap-south-1

# Get specific user
aws dynamodb get-item \
  --table-name BuildexUsers \
  --key '{"userId": {"S": "test_user"}}' \
  --region ap-south-1
```

### **Monitor API Gateway**

```bash
# Get API ID
aws apigatewayv2 get-apis --region ap-south-1

# View access logs (if enabled)
aws logs tail /aws/apigateway/buildex-api --follow
```

---

## 🔐 Security Best Practices

1. **Never commit `.env` files** - Already in `.gitignore`
2. **Use IAM roles** instead of access keys when possible
3. **Rotate credentials** every 90 days
4. **Enable MFA** on AWS root account
5. **Use least-privilege IAM policies** for Lambda functions
6. **Validate user input** in Lambda handlers
7. **Enable CloudTrail** for audit logging

---

## 📚 Key Documentation Links

- [Electron Documentation](https://www.electronjs.org/docs/latest/)
- [Monaco Editor API](https://microsoft.github.io/monaco-editor/docs.html)
- [AWS SDK for JavaScript v3](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/)
- [Amazon Bedrock API Reference](https://docs.aws.amazon.com/bedrock/latest/APIReference/welcome.html)
- [AWS SAM Developer Guide](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/what-is-sam.html)
- [DynamoDB Developer Guide](https://docs.aws.amazon.com/dynamodb/)

---

## 🎯 Next Steps

After completing setup, explore:

1. **Add new AI modes** - Customize Socratic prompts
2. **Enhance UI** - Add gamification elements
3. **Integrate more AWS services** - OpenSearch, Step Functions, EventBridge
4. **Build web version** - Deploy to AWS Amplify
5. **Write tests** - Unit tests for handlers, integration tests for flows
6. **Optimize performance** - Lambda cold start optimization, DynamoDB query tuning

---

## 💬 Need Help?

- **Documentation:** [PROJECT_OVERVIEW.md](./PROJECT_OVERVIEW.md)
- **AWS Setup:** [AWS_SETUP_AND_INTEGRATION_GUIDE.md](./AWS_SETUP_AND_INTEGRATION_GUIDE.md)
- **Auth Setup:** [ONBOARDING_AND_COGNITO_AUTH_SETUP.md](./ONBOARDING_AND_COGNITO_AUTH_SETUP.md)
- **Backend Roadmap:** [yusha_plan.md](./yusha_plan.md)
- **Frontend Roadmap:** [likith_plan.md](./likith_plan.md)

---

**Happy Coding! 🚀**
