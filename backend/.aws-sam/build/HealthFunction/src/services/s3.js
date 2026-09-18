import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const s3Client = new S3Client({
  region: process.env.AWS_REGION || "ap-south-1"
});

export const BUCKET_NAME = process.env.STORAGE_BUCKET || "buildex-storage";

export async function createUploadPresignedUrl(key, contentType = "application/zip") {
  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    ContentType: contentType
  });
  return await getSignedUrl(s3Client, command, { expiresIn: 3600 });
}

export async function createDownloadPresignedUrl(key) {
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key
  });
  return await getSignedUrl(s3Client, command, { expiresIn: 3600 });
}
