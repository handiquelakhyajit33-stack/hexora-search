```javascript
const DEFAULT_SEEDS = [
  "https://en.wikipedia.org/",
  "https://www.india.gov.in/",
  "https://assam.gov.in/",
  "https://www.python.org/",
  "https://www.w3.org/"
];

export async function crawlBatch(
  supabase,
  limit = Number(process.env.CRAWL_BATCH_SIZE || 12)
) {
  const seedText =
    process.env.HEXORA_SEED_URLS || DEFAULT_SEEDS.join(",");

  const seeds = seedText
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

  await supabase
    .from("crawl_queue")
    .upsert(
      seeds.map((url) => ({
        url,
        status: "queued"
      })),
      {
        onConflict: "url",
        ignoreDuplicates: true
      }
    );

  // Recover jobs left in "crawling" state after a worker restart.
  await supabase
    .from("crawl_queue")
    .update({
      status: "queued",
      last_error: "Requeued after worker restart"
    })
    .eq("status", "crawling");

  const { data, error } = await supabase
    .from("crawl_queue")
    .select("url")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) throw error;

  const urls = (data || []).map((x) => x.url);

  const concurrency = Math.max(
    1,
    Number(process.env.CRAWL_CONCURRENCY || 3)
  );

  for (let i = 0; i < urls.length; i += concurrency) {
    await Promise.all(
      urls.slice(i, i + concurrency).map(async (url) => {
        try {
          await crawlOne(supabase, url);
        } catch (e) {
          await supabase
            .from("crawl_queue")
            .update({
              status: "error",
              last_error: String(e).slice(0, 500)
            })
            .eq("url", url);
        }
      })
    );
  }

  return {
    processed: urls.length
  };
}

async function crawlOne(sb, url) {
  await sb
    .from("crawl_queue")
    .update({
      status: "crawling",
      last_error: null
    })
    .eq("url", url);

  const u = new URL(url);

  const robots = await getRobots(u.origin);

  if (!robots.canFetch("HEXORA-Bot/1.0", url)) {
    await sb
      .from("crawl_queue")
      .update({
        status: "blocked",
        last_error: "Blocked by robots.txt"
      })
      .eq("url", url);

    return;
  }

  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      "user-agent": "HEXORA-Bot/1.0",
      accept: "text/html,application/xhtml+xml"
    },
    signal: AbortSignal.timeout(12000)
  });

  const contentType = response.headers.get("content-type") || "";

  if (!response.ok || !contentType.includes("text/html")) {
    throw new Error(`HTTP ${response.status}`);
  }

  const html = await response.text();

  const parsed = parseHtml(
    new URL(response.url).toString(),
    html
  );

  const hash = await sha256(parsed.text);

  const { error: pageError } = await sb
    .from("pages")
    .upsert(
      {
        url: parsed.canonical,
        title: parsed.title,
        description: parsed.description,
        content: parsed.text,
        content_hash: hash,
        word_count: countWords(parsed.text),
        language: detectLanguage(parsed.text),
        updated_at: new Date().toISOString()
      },
      {
        onConflict: "url"
      }
    );

  if (pageError) throw pageError;

  const links = parsed.links.map((link) => ({
    url: link,
    status: "queued"
  }));

  if (links.length) {
    await sb
      .from("crawl_queue")
      .upsert(links, {
        onConflict: "url",
        ignoreDuplicates: true
      });
  }

  await sb
    .from("crawl_queue")
    .update({
      status: "done",
      last_crawled_at: new Date().toISOString(),
      last_error: null
    })
    .eq("url", url);
}

async function getRobots(origin) {
  try {
    const response = await fetch(`${origin}/robots.txt`, {
      headers: {
        "user-agent": "HEXORA-Bot/1.0"
      },
      signal: AbortSignal.timeout(5000)
    });

    const text = response.ok ? await response.text() : "";

    return new Robots(text, origin);
  } catch {
    return new Robots("", origin);
  }
}

class Robots {
  constructor(text, origin) {
    this.origin = origin;
    this.disallow = [];

    let active = false;

    for (const line of text.split(/\r?\n/)) {
      const [keyPart, ...valueParts] = line.split(":");

      if (!keyPart) continue;

      const key = keyPart.trim().toLowerCase();
      const value = valueParts.join(":").trim();

      if (key === "user-agent") {
        active =
          value === "*" ||
          value.toLowerCase() === "hexora-bot";
      }

      if (key === "disallow" && active && value) {
        this.disallow.push(value);
      }
    }
  }

  canFetch(_, url) {
    try {
      const parsed = new URL(url);

      return !this.disallow.some((path) =>
        parsed.pathname.startsWith(path)
      );
    } catch {
      return false;
    }
  }
}

function parseHtml(url, html) {
  const title =
    (
      html.match(
        /<title[^>]*>([\s\S]*?)<\/title>/i
      )?.[1] ||
      new URL(url).hostname
    )
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 500);

  const description =
    html.match(
      /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)/i
    )?.[1]?.slice(0, 1000) || "";

  const canonical =
    html.match(
      /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)/i
    )?.[1];

  let baseUrl = url;

  try {
    if (canonical) {
      baseUrl = new URL(canonical, url).toString();
    }
  } catch {
    baseUrl = url;
  }

  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200000);

  const links = [
    ...html.matchAll(
      /<a[^>]+href=["']([^"']+)["']/gi
    )
  ]
    .map((match) => {
      try {
        const link = new URL(match[1], url);

        if (
          link.protocol === "http:" ||
          link.protocol === "https:"
        ) {
          link.hash = "";
          return link.toString();
        }

        return null;
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .slice(0, 150);

  return {
    title,
    description,
    canonical: baseUrl,
    text,
    links: [...new Set(links)]
  };
}

function countWords(text) {
  if (!text) return 0;

  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .length;
}

function detectLanguage(text) {
  if (!text) return "unknown";

  // Basic script detection.
  if (/[\u0980-\u09FF]/.test(text)) {
    return "as";
  }

  if (/[\u0900-\u097F]/.test(text)) {
    return "hi";
  }

  if (/[\u4E00-\u9FFF]/.test(text)) {
    return "zh";
  }

  if (/[\u3040-\u30FF]/.test(text)) {
    return "ja";
  }

  if (/[\uAC00-\uD7AF]/.test(text)) {
    return "ko";
  }

  return "en";
}

async function sha256(text) {
  const bytes = new TextEncoder().encode(text);

  const hash = await crypto.subtle.digest(
    "SHA-256",
    bytes
  );

  return [...new Uint8Array(hash)]
    .map((byte) =>
      byte.toString(16).padStart(2, "0")
    )
    .join("");
}
```
