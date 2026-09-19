#!/usr/bin/env bash
set -e

# ==============================================================================
# BuildeX Web Platform — AWS S3 Static Website Hosting Deployment Script
# Region: ap-south-1 (Mumbai)
# ==============================================================================

REGION="ap-south-1"
ACCOUNT_ID=$(aws sts get-caller-identity --query "Account" --output text 2>/dev/null || echo "052477895001")
BUCKET_NAME="buildex-ide-web-${ACCOUNT_ID}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "🚀 Deploying BuildeX Web Platform to AWS S3..."
echo "📦 Bucket: ${BUCKET_NAME} (${REGION})"

# 1. Create bucket if it doesn't exist
if ! aws s3api head-bucket --bucket "${BUCKET_NAME}" 2>/dev/null; then
  echo "✨ Creating S3 bucket ${BUCKET_NAME}..."
  aws s3api create-bucket \
    --bucket "${BUCKET_NAME}" \
    --region "${REGION}" \
    --create-bucket-configuration LocationConstraint="${REGION}"
else
  echo "✔ S3 bucket ${BUCKET_NAME} already exists."
fi

# 2. Configure public access block (allow public read for website hosting)
echo "🔓 Configuring public access settings..."
aws s3api put-public-access-block \
  --bucket "${BUCKET_NAME}" \
  --public-access-block-configuration "BlockPublicAcls=false,IgnorePublicAcls=false,BlockPublicPolicy=false,RestrictPublicBuckets=false"

# 3. Apply public read policy
echo "🛡 Applying S3 public read bucket policy..."
POLICY_JSON=$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicReadGetObject",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::${BUCKET_NAME}/*"
    }
  ]
}
EOF
)

aws s3api put-bucket-policy \
  --bucket "${BUCKET_NAME}" \
  --policy "${POLICY_JSON}"

# 4. Enable Static Website Hosting
echo "🌐 Enabling S3 static website hosting..."
aws s3api put-bucket-website \
  --bucket "${BUCKET_NAME}" \
  --website-configuration '{"IndexDocument": {"Suffix": "index.html"}, "ErrorDocument": {"Key": "index.html"}}'

# 5. Sync website assets (protecting downloads/ release directory)
echo "📤 Uploading website files..."
aws s3 sync "${DIR}" "s3://${BUCKET_NAME}/" \
  --delete \
  --exclude "deploy.sh" \
  --exclude "downloads/*" \
  --exclude ".*"

WEBSITE_URL="http://${BUCKET_NAME}.s3-website.${REGION}.amazonaws.com"
AMPLIFY_APP_ID="d2wsru6nucplkr"

# 6. Deploy to AWS Amplify Hosting
echo "⚡ Syncing to AWS Amplify Hosting (App ID: ${AMPLIFY_APP_ID})..."
ZIP_TMP="/tmp/buildex-website-deploy.zip"
(cd "${DIR}" && zip -qr "${ZIP_TMP}" . -x "deploy.sh" -x ".*")

DEPLOY_RES=$(aws amplify create-deployment --app-id "${AMPLIFY_APP_ID}" --branch-name main --region "${REGION}")
JOB_ID=$(echo "${DEPLOY_RES}" | grep -o '"jobId": "[^"]*' | cut -d'"' -f4)
UPLOAD_URL=$(echo "${DEPLOY_RES}" | grep -o '"zipUploadUrl": "[^"]*' | cut -d'"' -f4)

if [ -n "${UPLOAD_URL}" ] && [ -n "${JOB_ID}" ]; then
  curl -s -T "${ZIP_TMP}" "${UPLOAD_URL}"
  aws amplify start-deployment --app-id "${AMPLIFY_APP_ID}" --branch-name main --job-id "${JOB_ID}" --region "${REGION}" >/dev/null
  echo "✔ Amplify deployment started (Job #${JOB_ID})."
fi
rm -f "${ZIP_TMP}"

echo ""
echo "=============================================================================="
echo "🎉 BuildeX Web Platform is LIVE!"
echo "🔗 S3 Endpoint:      ${WEBSITE_URL}"
echo "⚡ Amplify App:      https://main.${AMPLIFY_APP_ID}.amplifyapp.com"
echo "🌐 Production Domain: https://buildexide.dev"
echo "=============================================================================="
