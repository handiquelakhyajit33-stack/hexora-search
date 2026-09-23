import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8080);
const HOST = "0.0.0.0";

// SUPABASE
function db() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing"
    );
  }

  return createClient(url, key);
}

// RESPONSE
function send(res, status, data, type = "application/json") {
  res.writeHead(status, {
    "content-type": type,
    "cache-control": "no-store"
  });

  res.end(
    type.includes("json")
      ? JSON.stringify(data)
      : data
  );
}

// SEARCH SCORING
function escRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function score(p, words) {
  const title = (p.title || "").toLowerCase();
  const description = (p.description || "").toLowerCase();
  const url = (p.url || "").toLowerCase();
  const content = (p.content || "").toLowerCase();

  let score = 0;

  for (const word of words) {
    if (title.includes(word)) score += 30;
    if (description.includes(word)) score += 12;
    if (url.includes(word)) score += 8;

    score += Math.min(
      (content.match(new RegExp(escRegExp(word), "g")) || []).length,
      25
    );
  }

  if (words.length > 1 && words.every(w => title.includes(w))) {
    score += 40;
  }

  return score;
}

// NEWS SCORING
function newsScore(n, words) {
  const title = (n.title || "").toLowerCase();
  const description = (n.description || "").toLowerCase();
  const source = (n.source_name || "").toLowerCase();

  let score = 0;

  for (const word of words) {
    if (title.includes(word)) score += 40;
    if (description.includes(word)) score += 15;
    if (source.includes(word)) score += 4;
  }

  const age = n.published_at
    ? Math.max(
        0,
        (Date.now() - Date.parse(n.published_at)) / 86400000
      )
    : 999;

  return score + Math.max(0, 20 - age);
}

// SNIPPET
function snippet(p, words) {
  const text = (p.content || p.description || "")
    .replace(/\s+/g, " ");

  let at = Infinity;

  for (const word of words) {
    const index = text.toLowerCase().indexOf(word);

    if (index >= 0) {
      at = Math.min(at, index);
    }
  }

  if (!isFinite(at)) {
    return text.slice(0, 280);
  }

  return text.slice(
    Math.max(0, at - 110),
    at + 230
  );
}

// SEARCH
async function search(q) {
  const words = [
    ...new Set(
      q
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean)
    )
  ].slice(0, 8);

  const sb = db();

  const [
    { data: pages, error: pageError },
    { data: newsData, error: newsError }
  ] = await Promise.all([
    sb
      .from("pages")
      .select(
        "url,title,description,content,updated_at"
      )
      .limit(1200),

    sb
      .from("news")
      .select(
        "title,description,url,source_name,source_domain,published_at,image_url"
      )
      .order("published_at", {
        ascending: false
      })
      .limit(300)
  ]);

  if (pageError) throw pageError;
  if (newsError) throw newsError;

  const pageResults = (pages || [])
    .map(p => ({
      ...p,
      type: "web",
      score: score(p, words),
      snippet: snippet(p, words)
    }))
    .filter(x => x.score > 0);

  const newsResults = (newsData || [])
    .map(n => ({
      ...n,
      type: "news",
      score: newsScore(n, words),
      snippet: n.description || ""
    }))
    .filter(x => x.score > 0);

  const results = [
    ...newsResults,
    ...pageResults
  ]
    .sort((a, b) => b.score - a.score)
    .slice(0, 30);

  return {
    query: q,
    total: results.length,
    results
  };
}

// NEWS
async function news() {
  const {
    data,
    error
  } = await db()
    .from("news")
    .select(
      "id,title,description,url,source_name,source_domain,published_at,image_url"
    )
    .order("published_at", {
      ascending: false
    })
    .limit(12);

  if (error) throw error;

  return {
    items: data || [],
    generated: false,
    source: "publisher feeds"
  };
}

// STATIC FILE TYPES
function contentType(file) {
  const ext = path.extname(file).toLowerCase();

  return (
    {
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".json": "application/json",
      ".svg": "image/svg+xml",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".ico": "image/x-icon"
    }[ext] || "application/octet-stream"
  );
}

// STATIC FRONTEND
function serveStatic(req, res) {
  let pathname = decodeURIComponent(
    new URL(
      req.url,
      `http://${req.headers.host || "localhost"}`
    ).pathname
  );

  if (pathname === "/") {
    pathname = "/index.html";
  }

  const root = path.resolve(__dirname);
  const file = path.resolve(
    root,
    "." + pathname
  );

  if (!file.startsWith(root)) {
    return send(res, 403, {
      error: "Forbidden"
    });
  }

  fs.readFile(file, (err, data) => {
    if (err) {
      if (!path.extname(pathname)) {
        return fs.readFile(
          path.join(root, "index.html"),
          (indexError, indexData) => {
            if (indexError) {
              return send(res, 404, {
                error: "Not found"
              });
            }

            return send(
              res,
              200,
              indexData,
              "text/html; charset=utf-8"
            );
          }
        );
      }

      return send(res, 404, {
        error: "Not found"
      });
    }

    return send(
      res,
      200,
      data,
      contentType(file)
    );
  });
}

// SERVER
const server = http.createServer(
  async (req, res) => {
    try {
      const u = new URL(
        req.url,
        `http://${req.headers.host || "localhost"}`
      );

      // HEALTH
      if (
        req.method === "GET" &&
        u.pathname === "/health"
      ) {
        return send(res, 200, {
          ok: true,
          service: "HEXORA",
          status: "running",
          port: PORT
        });
      }

      // SEARCH
      if (
        req.method === "GET" &&
        (
          u.pathname === "/search" ||
          u.pathname === "/api/search" ||
          u.pathname === "/.netlify/functions/search"
        )
      ) {
        const q = u.searchParams.get("q")?.trim();

        if (!q) {
          return send(res, 400, {
            error: "Missing search query"
          });
        }

        return send(
          res,
          200,
          await search(q)
        );
      }

      // NEWS
      if (
        req.method === "GET" &&
        (
          u.pathname === "/news" ||
          u.pathname === "/api/news" ||
          u.pathname === "/.netlify/functions/news"
        )
      ) {
        return send(
          res,
          200,
          await news()
        );
      }

      // FRONTEND
      return serveStatic(req, res);

    } catch (error) {
      console.error(
        "HEXORA SERVER ERROR:",
        error
      );

      return send(res, 500, {
        error:
          error?.message ||
          "Server error"
      });
    }
  }
);

server.listen(
  PORT,
  HOST,
  () => {
    console.log(
      `HEXORA server running on http://${HOST}:${PORT}`
    );
  }
);

// CRAWLER
if (process.env.DISABLE_CRAWLER !== "1") {
  const child = spawn(
    process.execPath,
    [
      path.join(
        __dirname,
        "worker/worker.mjs"
      )
    ],
    {
      stdio: "inherit",
      env: process.env
    }
  );

  child.on("exit", code => {
    console.log(
      `HEXORA crawler exited with code ${code}`
    );
  });

  const stop = () => {
    try {
      child.kill("SIGTERM");
    } catch {}

    server.close(() => {
      process.exit(0);
    });
  };

  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}
