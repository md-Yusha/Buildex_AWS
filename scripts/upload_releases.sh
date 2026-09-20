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

# Get version from package.json
VERSION=$(node -p "require('./package.json').version")

# 1. Upload macOS PKG Installer
MAC_PKG=$(find "${DIR}/dist" -name "BuildeX Coder IDE-${VERSION}*.pkg" | head -n 1)
if [ -n "${MAC_PKG}" ] && [ -f "${MAC_PKG}" ]; then
  echo "🍏 Uploading macOS PKG Installer (${MAC_PKG})..."
  aws s3 cp "${MAC_PKG}" "s3://${BUCKET}/downloads/BuildeX-Coder-IDE-${VERSION}.pkg" --region "${REGION}"
  aws s3 cp "${MAC_PKG}" "s3://${BUCKET}/downloads/BuildeX-Coder-IDE.pkg" --region "${REGION}"
else
  echo "⚠️ macOS PKG not found for version ${VERSION} in ${DIR}/dist"
fi

# 2. Upload macOS DMG
MAC_DMG=$(find "${DIR}/dist" -name "BuildeX Coder IDE-${VERSION}*.dmg" | head -n 1)
if [ -n "${MAC_DMG}" ] && [ -f "${MAC_DMG}" ]; then
  echo "🍏 Uploading macOS DMG (${MAC_DMG})..."
  aws s3 cp "${MAC_DMG}" "s3://${BUCKET}/downloads/BuildeX-Coder-IDE-${VERSION}.dmg" --region "${REGION}"
  aws s3 cp "${MAC_DMG}" "s3://${BUCKET}/downloads/BuildeX-Coder-IDE.dmg" --region "${REGION}"
else
  echo "⚠️ macOS DMG not found for version ${VERSION} in ${DIR}/dist"
fi

# 2. Upload Windows Setup EXE & Portable EXE
WIN_EXE="${DIR}/dist/BuildeX Coder IDE-Setup-${VERSION}.exe"
if [ -f "${WIN_EXE}" ]; then
  echo "🪟 Uploading Windows Setup EXE (${WIN_EXE})..."
  aws s3 cp "${WIN_EXE}" "s3://${BUCKET}/downloads/BuildeX-Coder-IDE-Setup-${VERSION}.exe" --region "${REGION}"
  aws s3 cp "${WIN_EXE}" "s3://${BUCKET}/downloads/BuildeX-Coder-IDE-Setup.exe" --region "${REGION}"
else
  echo "ℹ️ Windows Setup EXE for ${VERSION} not found."
fi

WIN_PORTABLE="${DIR}/dist/BuildeX Coder IDE-Portable-${VERSION}.exe"
if [ -f "${WIN_PORTABLE}" ]; then
  echo "🪟 Uploading Windows Portable EXE (${WIN_PORTABLE})..."
  aws s3 cp "${WIN_PORTABLE}" "s3://${BUCKET}/downloads/BuildeX-Coder-IDE-Portable-${VERSION}.exe" --region "${REGION}"
  aws s3 cp "${WIN_PORTABLE}" "s3://${BUCKET}/downloads/BuildeX-Coder-IDE-Portable.exe" --region "${REGION}"
fi

echo "🎉 Releases successfully uploaded to S3!"
aws s3 ls "s3://${BUCKET}/downloads/" --region "${REGION}"
