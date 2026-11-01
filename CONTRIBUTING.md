# BuildeX — Quick Start for Contributors

Clone the repo, grab a few secrets, and you're running locally in ~5 minutes.

## 1. Prerequisites

- Node.js 18+
- npm
- AWS CLI (for backend deploy only — not needed for the website)

## 2. Get the secrets (ask the owner)

Put these in a local file. Do **not** commit them.

### Backend (`backend/`)

Create `backend/.env` (or export them in your shell):

```bash
# AWS
AWS_REGION=ap-south-1
AWS_ACCESS_KEY_ID=<key>
AWS_SECRET_ACCESS_KEY=<secret>

# Cognito
COGNITO_USER_POOL_ID=ap-south-1_DFJckvu7H
COGNITO_CLIENT_ID=1t0auvpbcr0lb9eb5c3tdunog5

# DynamoDB
DYNAMODB_TABLE_USERS=<table>
DYNAMODB_TABLE_SESSIONS=<table>
DYNAMODB_TABLE_CHATS=<table>
DYNAMODB_TABLE_PROJECTS=<table>

# S3
S3_BUCKET_PROJECTS=buildex-projects-storage-052477895001

# Bedrock (optional for local dev)
BEDROCK_MODEL_ID=amazon.nova-micro-v1:0

# Razorpay
RAZORPAY_KEY_ID=rzp_live_<id>
RAZORPAY_KEY_SECRET=<secret>
```

The DynamoDB table names are in the SAM stack outputs (`backend/samconfig.toml` + CloudFormation). Ask the owner or run:

```bash
aws cloudformation describe-stacks --stack-name buildex-backend-prod --region ap-south-1
```

### Website (`website/`)

No secrets — it's a static site. It calls the live API + Cognito directly. Just `npm start` or open `index.html`.

## 3. Run the website locally

```bash
cd website
# Option A: open index.html directly in a browser
# Option B: serve it
npx serve . -p 3000
```

The site hard-codes `apiBase` + `cognitoDomain` to the live production endpoints, so it works against the real backend out of the box.

## 4. Run the backend locally (optional)

```bash
cd backend
sam build
sam local-start-api --port 3000
```

Point the website's `CONFIG.apiBase` at `http://localhost:3000` if you want to test against local Lambdas instead of prod.

## 5. Deploy (owner only — needs AWS creds)

```bash
# Backend
cd backend && sam build && sam deploy --stack-name buildex-backend-prod --resolve-s3 --no-confirm-changeset

# Website (currently on Vercel)
cd website && npx vercel --prod
```

## Layout

```
backend/          SAM stack (7 Lambdas + API Gateway + Cognito + DynamoDB)
website/          Static marketing + auth + payment UI (Vercel)
launch-buildex.ps1    Desktop app launcher (Electron)
test-production.ps1   Smoke test for the live API
```

## Known issues (as of 2026-10-29)

- Razorpay key is shared with imycollections.co.in (same account). Merchant name on the checkout is "IMY Collections" — cosmetic only.
- Prices are currently ₹1 / ₹2 (test). Real prices: ₹649 / ₹1999. See `backend/src/handlers/payment.js` → `PLANS`.
- `buildexide.dev` CNAME on CloudFront is still claimed by a deleted distribution (AWS ~60-day timer). Frontend is on Vercel meanwhile.
