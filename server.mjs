```javascript
// ============================================================
// HEXORA SEARCH ENGINE
// SERVER
// NEON PRIMARY + SUPABASE LEGACY READ-ONLY
// ============================================================

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";
import pg from "pg";

const { Pool } = pg;

// ============================================================
// BASIC CONFIG
// ============================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 8080);

// ============================================================
// ENVIRONMENT VARIABLES
// ============================================================

const DATABASE_URL =
  process.env.DATABASE_URL ||
  process.env.NEON_DATABASE_URL ||
  "";

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  "";

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  "";

const ENABLE_SUPABASE_FALLBACK =
  String(
    process.env.ENABLE_SUPABASE_FALLBACK || "false"
  ).toLowerCase() === "true";

// ============================================================
// DATABASE URL
// ============================================================

function normalizeDatabaseUrl(url) {
  if (!url) {
    return "";
  }

  let value = String(url);

  value = value.replace(
    /([?&])sslmode=(prefer|require|verify-ca)/gi,
    "$1sslmode=verify-full"
  );

  return value;
}

const NORMALIZED_DATABASE_URL =
  normalizeDatabaseUrl(DATABASE_URL);

// ============================================================
// NEON CONNECTION
// ============================================================

let neonPool = null;

if (NORMALIZED_DATABASE_URL) {
  neonPool = new Pool({
    connectionString: NORMALIZED_DATABASE_URL,

    max: Number(
      process.env.DB_POOL_MAX || 5
    ),

    idleTimeoutMillis: 30000,

    connectionTimeoutMillis: 10000
  });
}

// ============================================================
// SUPABASE
// LEGACY READ-ONLY FALLBACK
// ============================================================

let supabase = null;

if (
  SUPABASE_URL &&
  SUPABASE_SERVICE_ROLE_KEY
) {
  supabase = createClient(
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      }
    }
  );
}

// ============================================================
// STATUS
// ============================================================

let neonConnected = false;

let requestCount = 0;

let searchCount = 0;

// ============================================================
// LOGGING
// ============================================================

function log(...args) {
  console.log(
    "[HEXORA]",
    ...args
  );
}

function logError(...args) {
  console.error(
    "[HEXORA]",
    ...args
  );
}

// ============================================================
// NEON HEALTH CHECK
// ============================================================

async function checkNeon() {
  if (!neonPool) {
    neonConnected = false;

    logError(
      "DATABASE_URL / NEON_DATABASE_URL is missing"
    );

    return false;
  }

  try {
    await neonPool.query(
      "SELECT 1"
    );

    neonConnected = true;

    log(
      "Neon PostgreSQL: CONNECTED"
    );

    return true;
  } catch (error) {
    neonConnected = false;

    logError(
      "Neon connection check failed:",
      error?.message || error
    );

    return false;
  }
}

// ============================================================
// TEXT HELPERS
// ============================================================

function cleanText(
  value,
  maxLength = 500
) {
  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  return String(value)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function decodeSafe(value) {
  try {
    return decodeURIComponent(
      value
    );
  } catch
```
