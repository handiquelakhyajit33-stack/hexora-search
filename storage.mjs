// ============================================================
// HEXORA SEARCH ENGINE
// CLOUDFLARE R2 STORAGE
// ============================================================

import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand
} from "@aws-sdk/client-s3";

// ============================================================
// ENVIRONMENT
// ============================================================

const ACCOUNT_ID =
  process.env.R2_ACCOUNT_ID || "";

const ACCESS_KEY_ID =
  process.env.R2_ACCESS_KEY_ID || "";

const SECRET_ACCESS_KEY =
  process.env.R2_SECRET_ACCESS_KEY || "";

const BUCKET_NAME =
  process.env.R2_BUCKET_NAME ||
  process.env.R2_BUCKET ||
  "hexoraase";

// ============================================================
// VALIDATION
// ============================================================

function checkConfig() {
  const missing = [];

  if (!ACCOUNT_ID) {
    missing.push("R2_ACCOUNT_ID");
  }

  if (!ACCESS_KEY_ID) {
    missing.push("R2_ACCESS_KEY_ID");
  }

  if (!SECRET_ACCESS_KEY) {
    missing.push("R2_SECRET_ACCESS_KEY");
  }

  if (!BUCKET_NAME) {
    missing.push("R2_BUCKET_NAME");
  }

  if (missing.length > 0) {
    throw new Error(
      `[HEXORA] R2 configuration missing: ${missing.join(", ")}`
    );
  }
}

// ============================================================
// R2 CLIENT
// ============================================================

let r2 = null;

function getR2Client() {
  checkConfig();

  if (!r2) {
    r2 = new S3Client({
      region: "auto",

      endpoint:
        `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,

      credentials: {
        accessKeyId: ACCESS_KEY_ID,
        secretAccessKey: SECRET_ACCESS_KEY
      }
    });
  }

  return r2;
}

// ============================================================
// SAFE HASH
// ============================================================

function safePart(value, maxLength = 100) {
  return String(value || "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, maxLength);
}

// ============================================================
// CREATE R2 KEY
// ============================================================

export function makeR2Key(
  url,
  contentHash = ""
) {
  let hostname = "unknown";
  let pathname = "/";

  try {
    const parsed = new URL(url);

    hostname =
      parsed.hostname
        .toLowerCase()
        .replace(/[^a-z0-9.-]/g, "_");

    pathname =
      parsed.pathname || "/";
  } catch {
    hostname = "unknown";
    pathname = "/";
  }

  let cleanPath =
    pathname
      .replace(/^\/+/, "")
      .replace(/\/+/g, "/")
      .replace(
        /[^a-zA-Z0-9._/-]/g,
        "_"
      )
      .slice(0, 250);

  if (!cleanPath) {
    cleanPath = "index";
  }

  const hash =
    String(contentHash || "")
      .replace(
        /[^a-zA-Z0-9_-]/g,
        ""
      )
      .slice(0, 64) ||
    "nohash";

  return (
    `pages/` +
    `${safePart(hostname, 180)}/` +
    `${cleanPath}/` +
    `${hash}.html`
  );
}

// ============================================================
// SAVE HTML
//
// IMPORTANT:
// This function accepts BOTH:
//
// putHtml({
//   url,
//   html,
//   contentHash
// })
//
// AND:
//
// putHtml(url, html, metadata)
//
// This keeps old HEXORA code compatible.
// ============================================================

export async function putHtml(
  arg1,
  arg2 = null,
  arg3 = null
) {
  let url = "";
  let html = "";
  let contentHash = "";
  let metadata = {};

  // ----------------------------------------------------------
  // NEW OBJECT STYLE
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
      String(arg1.contentHash || "");

    metadata =
      arg1.metadata ||
      {};
  }

  // ----------------------------------------------------------
  // OLD POSITIONAL STYLE
  // putHtml(url, html, metadata)
  // ----------------------------------------------------------

  else {
    url =
      String(arg1 || "");

    html =
      String(arg2 || "");

    metadata =
      arg3 &&
      typeof arg3 === "object"
        ? arg3
        : {};

    contentHash =
      String(
        metadata.contentHash ||
        ""
      );
  }

  if (!url) {
    throw new Error(
      "R2 upload failed: URL is empty"
    );
  }

  if (!html) {
    throw new Error(
      "R2 upload failed: HTML content is empty"
    );
  }

  // ----------------------------------------------------------
  // HASH IF NOT PROVIDED
  // ----------------------------------------------------------

  if (!contentHash) {
    const crypto =
      await import("node:crypto");

    contentHash =
      crypto
        .createHash("sha256")
        .update(html)
        .digest("hex");
  }

  // ----------------------------------------------------------
  // R2 KEY
  // ----------------------------------------------------------

  const key =
    makeR2Key(
      url,
      contentHash
    );

  // ----------------------------------------------------------
  // METADATA
  // ----------------------------------------------------------

  const source =
    String(
      metadata.source ||
      "hexora"
    ).slice(0, 100);

  const sourceUrl =
    String(
      metadata["source-url"] ||
      metadata.sourceUrl ||
      url
    ).slice(0, 2000);

  // ----------------------------------------------------------
  // UPLOAD
  // ----------------------------------------------------------

  const client =
    getR2Client();

  const result =
    await client.send(
      new PutObjectCommand({
        Bucket: BUCKET_NAME,

        Key: key,

        Body: html,

        ContentType:
          "text/html; charset=utf-8",

        Metadata: {
          "source":
            source,

          "source-url":
            sourceUrl,

          "content-hash":
            contentHash.slice(0, 64)
        }
      })
    );

  // ----------------------------------------------------------
  // RESULT
  // ----------------------------------------------------------

  return {
    bucket:
      BUCKET_NAME,

    key,

    etag:
      result.ETag
        ? String(result.ETag)
            .replace(/^"|"$/g, "")
        : "",

    contentHash
  };
}

// ============================================================
// HEAD OBJECT
// ============================================================

export async function headObject(
  key
) {
  if (!key) {
    throw new Error(
      "R2 head failed: key is empty"
    );
  }

  const client =
    getR2Client();

  try {
    const result =
      await client.send(
        new HeadObjectCommand({
          Bucket:
            BUCKET_NAME,

          Key:
            key
        })
      );

    return {
      exists: true,

      size:
        Number(
          result.ContentLength ||
          0
        ),

      contentType:
        result.ContentType ||
        "",

      etag:
        result.ETag
          ? String(result.ETag)
              .replace(/^"|"$/g, "")
          : "",

      lastModified:
        result.LastModified ||
        null
    };
  } catch (error) {
    const status =
      error?.$metadata
        ?.httpStatusCode;

    if (
      status === 404 ||
      error?.name === "NotFound" ||
      error?.name === "NoSuchKey"
    ) {
      return {
        exists: false
      };
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

  const client =
    getR2Client();

  await client.send(
    new DeleteObjectCommand({
      Bucket:
        BUCKET_NAME,

      Key:
        key
    })
  );

  return true;
}

// ============================================================
// CHECK R2
// ============================================================

export async function checkR2() {
  try {
    checkConfig();

    const client =
      getR2Client();

    try {
      await client.send(
        new HeadObjectCommand({
          Bucket:
            BUCKET_NAME,

          Key:
            "__hexora_health_check__"
        })
      );

      return {
        connected: true,

        bucket:
          BUCKET_NAME,

        account:
          ACCOUNT_ID
      };
    } catch (error) {
      const status =
        error?.$metadata
          ?.httpStatusCode;

      // 404 = R2 connected,
      // object simply doesn't exist.
      if (
        status === 404 ||
        error?.name === "NotFound" ||
        error?.name === "NoSuchKey"
      ) {
        return {
          connected: true,

          bucket:
            BUCKET_NAME,

          account:
            ACCOUNT_ID
        };
      }

      throw error;
    }
  } catch (error) {
    return {
      connected: false,

      bucket:
        BUCKET_NAME,

      account:
        ACCOUNT_ID,

      error:
        error?.message ||
        String(error)
    };
  }
}

// ============================================================
// R2 CONFIG INFO
// ============================================================

export function getR2Config() {
  return {
    configured:
      Boolean(
        ACCOUNT_ID &&
        ACCESS_KEY_ID &&
        SECRET_ACCESS_KEY &&
        BUCKET_NAME
      ),

    bucket:
      BUCKET_NAME,

    account:
      ACCOUNT_ID
        ? `${ACCOUNT_ID.slice(0, 6)}...`
        : ""
  };
}

// ============================================================
// EXPORT CLIENT
// ============================================================

export {
  r2,
  BUCKET_NAME
};
