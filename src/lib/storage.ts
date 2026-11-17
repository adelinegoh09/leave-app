import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

function localRoot(): string {
  return process.env.UPLOAD_DIR || path.join(process.cwd(), "storage", "uploads");
}

function assertKey(key: string): void {
  if (!key || key.includes("..") || path.isAbsolute(key)) throw new Error("Invalid storage key");
}

function s3(): S3Client {
  return new S3Client({
    region: process.env.S3_REGION || "auto",
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    credentials:
      process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
        ? { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY }
        : undefined,
  });
}

export function storageDriver(): "s3" | "local" {
  return process.env.S3_BUCKET ? "s3" : "local";
}

export async function saveBytes(key: string, bytes: Buffer, mime: string): Promise<void> {
  assertKey(key);
  if (storageDriver() === "s3") {
    await s3().send(
      new PutObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: key,
        Body: bytes,
        ContentType: mime,
      }),
    );
    return;
  }
  const full = path.join(localRoot(), key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, bytes);
}

export async function readBytes(key: string): Promise<Buffer> {
  assertKey(key);
  if (storageDriver() === "s3") {
    const res = await s3().send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }));
    const bytes = await res.Body?.transformToByteArray();
    if (!bytes) throw new Error("Stored file was empty");
    return Buffer.from(bytes);
  }
  return readFile(path.join(localRoot(), key));
}
