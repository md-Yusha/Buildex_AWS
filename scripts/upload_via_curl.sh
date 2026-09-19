#!/usr/bin/env bash
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"

echo "🚀 Generating S3 presigned PUT URL for Windows EXE..."
URL=$(node -e "
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const fs = require('fs');

const env = fs.readFileSync('.env', 'utf8').split('\n').reduce((acc, l) => {
  const [k, ...v] = l.trim().split('=');
  if (k && v.length) acc[k.trim()] = v.join('=').trim().replace(/^['\"]|['\"]$/g, '');
  return acc;
}, {});

const s3 = new S3Client({
  region: 'ap-south-1',
  credentials: {
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY
  }
});

getSignedUrl(s3, new PutObjectCommand({
  Bucket: 'buildex-ide-web-052477895001',
  Key: 'downloads/BuildeX-Coder-IDE-Setup-1.1.0.exe',
  ContentType: 'application/vnd.microsoft.portable-executable'
}), { expiresIn: 7200 }).then(console.log);
")

echo "📦 Uploading Windows EXE via curl to S3..."
/usr/bin/curl \
  -f \
  --progress-bar \
  --retry 5 \
  --retry-delay 2 \
  --keepalive-time 15 \
  -X PUT \
  -H "Content-Type: application/vnd.microsoft.portable-executable" \
  --upload-file "dist/BuildeX Coder IDE-Setup-1.1.0.exe" \
  "$URL"

echo ""
echo "✅ Windows EXE upload completed successfully!"
echo "🔍 Verifying HTTP headers..."
curl -s -I "https://buildex-ide-web-052477895001.s3.ap-south-1.amazonaws.com/downloads/BuildeX-Coder-IDE-Setup-1.1.0.exe"
