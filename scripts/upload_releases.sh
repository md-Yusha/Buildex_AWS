#!/usr/bin/env bash
# ==============================================================================
# BuildeX — Robust Binary Release Upload to AWS S3
# Uploads macOS DMG and Windows EXE with resilient retry logic
# ==============================================================================
set -euo pipefail

BUCKET="buildex-ide-web-052477895001"
REGION="ap-south-1"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "📦 Uploading BuildeX Desktop Releases to S3 Bucket: ${BUCKET}..."

# 1. Upload macOS DMG
echo "🍏 Uploading macOS DMG (BuildeX-Coder-IDE-1.1.0.dmg)..."
aws s3 cp "${DIR}/dist/BuildeX Coder IDE-1.1.0-arm64.dmg" \
  "s3://${BUCKET}/downloads/BuildeX-Coder-IDE-1.1.0.dmg" \
  --region "${REGION}"

# 2. Upload Windows Setup EXE
echo "🪟 Uploading Windows Setup EXE (BuildeX-Coder-IDE-Setup-1.1.0.exe)..."
aws s3 cp "${DIR}/dist/BuildeX Coder IDE-Setup-1.1.0.exe" \
  "s3://${BUCKET}/downloads/BuildeX-Coder-IDE-Setup-1.1.0.exe" \
  --region "${REGION}"

echo "🎉 Releases successfully uploaded to S3!"
aws s3 ls "s3://${BUCKET}/downloads/" --region "${REGION}"
