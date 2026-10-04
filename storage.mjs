// ============================================================
// HEXORA STORAGE
// Cloudflare R2 Storage
// Bucket: hexora
// ============================================================

import crypto from "node:crypto";
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";

// ============================================================
// CONFIG
// ============================================================

const R2_ACCOUNT_ID =
  process.env.R2_ACCOUNT_ID || "";

const R2_ACCESS_KEY_ID =
  process.env.R2_ACCESS_KEY_ID || "";

const R2_SECRET_ACCESS_KEY =
  process.env.R2_SECRET_ACCESS_KEY || "";

const BUCKET_NAME =
  process.env.R2_BUCKET_NAME || "hexora";

if (!R2_ACCOUNT_ID) {
  console.warn(
    "[HEXORA] R2_ACCOUNT_ID is missing"
  );
}

if (!R2_ACCESS_KEY_ID) {
  console.warn(
    "[HEXORA] R2_ACCESS_KEY_ID is missing"
  );
}

if (!R2_SECRET_ACCESS_KEY) {
  console.warn(
    "[HEXORA] R2_SECRET_ACCESS_KEY is missing"
  );
}

// ============================================================
// R2 CLIENT
// ============================================================

const ENDPOINT =
  R2_ACCOUNT_ID
    ? `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
    : "";

export const r2 = new S3Client({
  region: "auto",

  endpoint: ENDPOINT || undefined,

  credentials:
    R2_ACCESS_KEY_ID &&
    R2_SECRET_ACCESS_KEY
      ? {
          accessKeyId:
            R2_ACCESS_KEY_ID,
          secretAccessKey:
            R2_SECRET_ACCESS_KEY,
        }
      : undefined,
});

// ============================================================
// MAKE R2 KEY
// ============================================================

export function makeR2Key(
  url,
  contentHash = ""
) {
  const safeHash =
    contentHash ||
    crypto
      .createHash("sha256")
      .update(String(url))
      .digest("hex");

  let hostname = "unknown";

  try {
    hostname = new URL(url)
      .hostname
      .toLowerCase()
      .replace(/^www\./, "");
  } catch {
    hostname = "unknown";
  }

  const hostSafe =
    hostname
      .replace(/[^a-z0-9.-]/gi, "-")
      .slice(0, 200);

  const hashSafe =
    String(safeHash)
      .replace(/[^a-z0-9]/gi, "")
      .slice(0, 64);

  return `pages/${hostSafe}/${hashSafe}.html`;
}

// ============================================================
// PUT HTML
//
// Supports:
//   putHtml({
//     url,
//     html,
//     contentHash,
//     metadata
//   })
//
// Also supports legacy:
//   putHtml(url, html, metadata)
// ============================================================

export async function putHtml(
  arg1,
  arg2,
  arg3
) {
  let url = "";
  let html = "";
  let contentHash = "";
  let metadata = {};

  // ----------------------------------------------------------
  // Object style
  // ----------------------------------------------------------

  if (
    arg1 &&
    typeof arg1 === "object" &&
    !Buffer.isBuffer(arg1)
  ) {
    url =
      String(arg1.url || "");

    html =
      String(arg1.html || "");

    contentHash =
      String(
        arg1.contentHash || ""
      );

    metadata =
      arg1.metadata || {};
  }

  // ----------------------------------------------------------
  // Legacy positional style
  // ----------------------------------------------------------

  else {
    url =
      String(arg1 || "");

    html =
      String(arg2 || "");

    metadata =
      arg3 || {};
  }

  if (!url) {
    throw new Error(
      "[HEXORA] R2 upload failed: URL missing"
    );
  }

  if (!html) {
    throw new Error(
      "[HEXORA] R2 upload failed: HTML missing"
    );
  }

  // ----------------------------------------------------------
  // Generate hash
  // ----------------------------------------------------------

  if (!contentHash) {
    contentHash =
      crypto
        .createHash("sha256")
        .update(html)
        .digest("hex");
  }

  // ----------------------------------------------------------
  // R2 key
  // ----------------------------------------------------------

  const key =
    makeR2Key(
      url,
      contentHash
    );

  // ----------------------------------------------------------
  // Metadata
  // ----------------------------------------------------------

  const cleanMetadata = {};

  for (
    const [keyName, value]
    of Object.entries(metadata || {})
  ) {
    if (
      value === undefined ||
      value === null
    ) {
      continue;
    }

    cleanMetadata[
      String(keyName)
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "-")
        .slice(0, 100)
    ] =
      String(value)
        .slice(0, 2000);
  }

  // ----------------------------------------------------------
  // Upload
  // ----------------------------------------------------------

  await r2.send(
    new PutObjectCommand({
      Bucket:
        BUCKET_NAME,

      Key:
        key,

      Body:
        Buffer.from(
          html,
          "utf8"
        ),

      ContentType:
        "text/html; charset=utf-8",

      Metadata:
        cleanMetadata,
    })
  );

  console.log(
    `[HEXORA] R2 saved: ${key}`
  );

  return {
    bucket:
      BUCKET_NAME,

    key,

    contentHash,

    etag:
      null,

    url,
  };
}

// ============================================================
// HEAD OBJECT
// ============================================================

export async function headObject(
  key
) {
  if (!key) {
    return null;
  }

  try {
    const result =
      await r2.send(
        new HeadObjectCommand({
          Bucket:
            BUCKET_NAME,

          Key:
            key,
        })
      );

    return result;
  } catch (error) {
    const status =
      error?.$metadata?.httpStatusCode;

    if (
      status === 404 ||
      error?.name ===
        "NotFound" ||
      error?.name ===
        "NoSuchKey"
    ) {
      return null;
    }

    throw error;
  }
}

// ============================================================
// DELETE OBJECT
// ============================================================

export async function deleteObject(
  key
) {
  if (!key) {
    return false;
  }

  await r2.send(
    new DeleteObjectCommand({
      Bucket:
        BUCKET_NAME,

      Key:
        key,
    })
  );

  console.log(
    `[HEXORA] R2 deleted: ${key}`
  );

  return true;
}

// ============================================================
// CHECK R2
// ============================================================

export async function checkR2() {
  if (
    !R2_ACCOUNT_ID ||
    !R2_ACCESS_KEY_ID ||
    !R2_SECRET_ACCESS_KEY
  ) {
    return {
      ok: false,

      bucket:
        BUCKET_NAME,

      error:
        "R2 environment variables are missing",
    };
  }

  try {
    // A deliberately impossible/non-existing key.
    // This verifies authentication without creating data.
    await r2.send(
      new HeadObjectCommand({
        Bucket:
          BUCKET_NAME,

        Key:
          "__hexora_connection_test__",
      })
    );

    return {
      ok: true,

      bucket:
        BUCKET_NAME,
    };
  } catch (error) {
    const status =
      error?.$metadata?.httpStatusCode;

    // 404 means authentication worked;
    // only the test object does not exist.
    if (
      status === 404 ||
      error?.name ===
        "NotFound" ||
      error?.name ===
        "NoSuchKey"
    ) {
      return {
        ok: true,

        bucket:
          BUCKET_NAME,
      };
    }

    return {
      ok: false,

      bucket:
        BUCKET_NAME,

      error:
        error?.message ||
        String(error),
    };
  }
}

// ============================================================
// R2 CONFIG
// ============================================================

export function getR2Config() {
  return {
    accountId:
      R2_ACCOUNT_ID,

    bucket:
      BUCKET_NAME,

    endpoint:
      ENDPOINT,
  };
}

// ============================================================
// DEFAULT EXPORT
// ============================================================

export default {
  r2,

  makeR2Key,

  putHtml,

  headObject,

  deleteObject,

  checkR2,

  getR2Config,
};
