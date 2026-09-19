#!/usr/bin/env bash
# ==============================================================================
# BuildeX — Upload Custom Branding & Theme to AWS Cognito Hosted UI
# ==============================================================================
set -euo pipefail

REGION="${AWS_REGION:-ap-south-1}"
USER_POOL_ID="${COGNITO_USER_POOL_ID:-ap-south-1_DFJckvu7H}"
CLIENT_ID="${COGNITO_CLIENT_ID:-1t0auvpbcr0lb9eb5c3tdunog5}"
CSS_PATH="$(dirname "$0")/cognito-theme.css"
LOGO_PATH="$(dirname "$0")/buildex-logo-cognito.png"

echo "🎨 Applying BuildeX Dark Theme to Cognito User Pool: ${USER_POOL_ID} (${REGION})..."

# 1. Apply to specific app client
aws cognito-idp set-ui-customization \
  --user-pool-id "${USER_POOL_ID}" \
  --client-id "${CLIENT_ID}" \
  --css "file://${CSS_PATH}" \
  --image-file "fileb://${LOGO_PATH}" \
  --region "${REGION}"

# 2. Apply to user pool default (ALL clients)
aws cognito-idp set-ui-customization \
  --user-pool-id "${USER_POOL_ID}" \
  --css "file://${CSS_PATH}" \
  --image-file "fileb://${LOGO_PATH}" \
  --region "${REGION}"

echo "✅ Successfully applied BuildeX Hosted UI Customization & Logo!"
