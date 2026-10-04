// ============================================================
// HEXORA - CLOUDFLARE R2 STORAGE
// ============================================================

import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";

// ============================================================
// CONFIG
// ============================================================

const ACCOUNT_ID = process.env.R2_ACCOUNT_ID || "";
const ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || "";
const SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || "";
const BUCKET_NAME = process.env.R2_BUCKET_NAME || "hexoraase";

if (!ACCOUNT_ID || !ACCESS_KEY_ID || !SECRET_ACCESS_KEY) {
  console.warn(
    "[HEXORA] R2 environment variables are not fully configured."
  );
}

// ============================================================
// R2 CLIENT
// ============================================================

const r2 = new S3Client({
  region: "auto",

  endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,

  credentials: {
    accessKeyId: ACCESS_KEY_ID,
    secretAccessKey: SECRET_ACCESS_KEY,
  },
});

// ============================================================
// CREATE SAFE R2 KEY
// ============================================================

export function makeR2Key(url, contentHash = "") {
  let hostname = "unknown";
  let pathname = "/";

  try {
    const parsed = new URL(url);

    hostname = parsed.hostname
      .toLowerCase()
      .replace(/[^a-z0-9.-]/g, "_");

    pathname = parsed.pathname || "/";
  } catch {
    hostname = "unknown";
    pathname = "/";
  }

  const cleanPath = pathname
    .replace(/^\/+/, "")
    .replace(/[^a-zA-Z0-9._/-]/g, "_")
    .slice(0, 300);

  const hash =
    String(contentHash || "")
      .replace(/[^a-zA-Z0-9_-]/g, "")
      .slice(0, 32) || "nohash";

  return `pages/${hostname}/${cleanPath || "index"}/${hash}.html`;
}

// ============================================================
// SAVE HTML TO R2
// ============================================================

export async function putHtml({
  url,
  html,
  contentHash = "",
}) {
  if (!html) {
    throw new Error("R2 upload failed: HTML content is empty");
  }

  const key = makeR2Key(url, contentHash);

  await r2.send(
    new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: html,
      ContentType: "text/html; charset=utf-8",
      Metadata: {
        source_url: String(url || "").slice(0, 2000),
      },
    })
  );

  return {
    bucket: BUCKET_NAME,
    key,
  };
}

// ============================================================
// CHECK OBJECT EXISTS
// ============================================================

export async function headObject(key) {
  try {
    const result = await r2.send(
      new HeadObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
      })
    );

    return {
      exists: true,
      size: result.ContentLength || 0,
      contentType: result.ContentType || "",
      lastModified: result.LastModified || null,
    };
  } catch (error) {
    const status = error?.$metadata?.httpStatusCode;

    if (status === 404 || error?.name === "NotFound") {
      return {
        exists: false,
      };
    }

    throw error;
  }
}

// ============================================================
// R2 HEALTH CHECK
// ============================================================

export async function checkR2() {
  if (!ACCOUNT_ID || !ACCESS_KEY_ID || !SECRET_ACCESS_KEY) {
    return {
      connected: false,
      bucket: BUCKET_NAME,
      error: "R2 environment variables missing",
    };
  }

  try {
    await r2.send(
      new HeadObjectCommand({
        Bucket: BUCKET_NAME,
        Key: "__hexora_health_check__",
      })
    );

    return {
      connected: true,
      bucket: BUCKET_NAME,
    };
  } catch (error) {
    // 404 means R2 itself is reachable.
    if (
      error?.$metadata?.httpStatusCode === 404 ||
      error?.name === "NotFound"
    ) {
      return {
        connected: true,
        bucket: BUCKET_NAME,
      };
    }

    return {
      connected: false,
      bucket: BUCKET_NAME,
      error: error?.message || String(error),
    };
  }
}

// ============================================================
// EXPORT CLIENT
// ============================================================

export { r2 };
