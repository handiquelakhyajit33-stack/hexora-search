CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS pages (
  id BIGSERIAL PRIMARY KEY,
  url TEXT NOT NULL UNIQUE,
  canonical_url TEXT,
  title TEXT DEFAULT '',
  description TEXT DEFAULT '',
  excerpt TEXT DEFAULT '',
  content TEXT DEFAULT '',
  domain TEXT,
  language TEXT DEFAULT 'unknown',
  content_hash TEXT,
  word_count INTEGER DEFAULT 0,
  status_code INTEGER DEFAULT 200,
  crawl_status TEXT DEFAULT 'indexed',

  first_seen_at TIMESTAMPTZ DEFAULT NOW(),
  last_crawled_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  published_at TIMESTAMPTZ,

  r2_key TEXT,
  r2_etag TEXT,

  authority_score DOUBLE PRECISION DEFAULT 0,
  freshness_score DOUBLE PRECISION DEFAULT 0,
  quality_score DOUBLE PRECISION DEFAULT 0,
  popularity_score DOUBLE PRECISION DEFAULT 0,

  inbound_links INTEGER DEFAULT 0,
  outbound_links INTEGER DEFAULT 0,

  search_vector TSVECTOR
);

CREATE INDEX IF NOT EXISTS pages_search_vector_idx
ON pages USING GIN(search_vector);

CREATE INDEX IF NOT EXISTS pages_title_trgm_idx
ON pages USING GIN(title gin_trgm_ops);

CREATE INDEX IF NOT EXISTS pages_url_trgm_idx
ON pages USING GIN(url gin_trgm_ops);

CREATE INDEX IF NOT EXISTS pages_content_trgm_idx
ON pages USING GIN(content gin_trgm_ops);

CREATE INDEX IF NOT EXISTS pages_domain_idx
ON pages(domain);

CREATE INDEX IF NOT EXISTS pages_updated_idx
ON pages(updated_at DESC);

CREATE INDEX IF NOT EXISTS pages_authority_idx
ON pages(authority_score DESC);


CREATE TABLE IF NOT EXISTS crawl_queue (
  id BIGSERIAL PRIMARY KEY,

  url TEXT NOT NULL UNIQUE,

  status TEXT NOT NULL DEFAULT 'pending'
  CHECK (
    status IN (
      'pending',
      'processing',
      'done',
      'failed',
      'blocked'
    )
  ),

  priority INTEGER DEFAULT 50,

  discovered_from TEXT,

  attempts INTEGER DEFAULT 0,

  error TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS crawl_queue_pick_idx
ON crawl_queue(
  status,
  priority DESC,
  created_at ASC
);


CREATE TABLE IF NOT EXISTS page_links (
  id BIGSERIAL PRIMARY KEY,

  source_page_id BIGINT
  REFERENCES pages(id)
  ON DELETE CASCADE,

  target_url TEXT NOT NULL,

  anchor_text TEXT DEFAULT '',

  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(
    source_page_id,
    target_url
  )
);

CREATE INDEX IF NOT EXISTS page_links_target_idx
ON page_links(target_url);

CREATE INDEX IF NOT EXISTS page_links_source_idx
ON page_links(source_page_id);


CREATE TABLE IF NOT EXISTS domains (
  id BIGSERIAL PRIMARY KEY,

  domain TEXT NOT NULL UNIQUE,

  pages_count INTEGER DEFAULT 0,

  inbound_links INTEGER DEFAULT 0,

  authority_score DOUBLE PRECISION DEFAULT 0,

  quality_score DOUBLE PRECISION DEFAULT 0,

  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS domains_authority_idx
ON domains(authority_score DESC);


CREATE OR REPLACE FUNCTION pages_search_vector_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN

  NEW.search_vector :=
      setweight(
        to_tsvector(
          'simple',
          COALESCE(NEW.title, '')
        ),
        'A'
      )

   ||

      setweight(
        to_tsvector(
          'simple',
          COALESCE(NEW.description, '')
        ),
        'B'
      )

   ||

      setweight(
        to_tsvector(
          'simple',
          COALESCE(NEW.excerpt, '')
        ),
        'B'
      )

   ||

      setweight(
        to_tsvector(
          'simple',
          COALESCE(NEW.content, '')
        ),
        'C'
      )

   ||

      setweight(
        to_tsvector(
          'simple',
          COALESCE(NEW.url, '')
        ),
        'D'
      );

  RETURN NEW;

END;
$$;


DROP TRIGGER IF EXISTS pages_search_vector_trigger
ON pages;


CREATE TRIGGER pages_search_vector_trigger

BEFORE INSERT OR UPDATE OF
  title,
  description,
  excerpt,
  content,
  url

ON pages

FOR EACH ROW

EXECUTE FUNCTION
pages_search_vector_update();


CREATE OR REPLACE FUNCTION refresh_domain_stats()
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN

  INSERT INTO domains(
    domain,
    pages_count,
    inbound_links,
    updated_at
  )

  SELECT
    domain,
    COUNT(*)::INTEGER,
    COALESCE(
      SUM(inbound_links),
      0
    )::INTEGER,
    NOW()

  FROM pages

  WHERE
    domain IS NOT NULL
    AND domain <> ''

  GROUP BY domain

  ON CONFLICT(domain)

  DO UPDATE SET

    pages_count =
      EXCLUDED.pages_count,

    inbound_links =
      EXCLUDED.inbound_links,

    updated_at =
      NOW();

END;
$$;


CREATE OR REPLACE FUNCTION claim_crawl_jobs(
  job_limit INTEGER DEFAULT 10
)

RETURNS TABLE(
  id BIGINT,
  url TEXT,
  priority INTEGER,
  discovered_from TEXT
)

LANGUAGE sql

AS $$

  WITH picked AS (

    SELECT q.id

    FROM crawl_queue q

    WHERE q.status = 'pending'

    ORDER BY
      q.priority DESC,
      q.created_at ASC

    FOR UPDATE SKIP LOCKED

    LIMIT GREATEST(
      job_limit,
      1
    )
  )

  UPDATE crawl_queue q

  SET
    status = 'processing',

    started_at = NOW(),

    attempts =
      q.attempts + 1,

    error = NULL

  FROM picked

  WHERE q.id = picked.id

  RETURNING
    q.id,
    q.url,
    q.priority,
    q.discovered_from;

$$;


CREATE OR REPLACE VIEW hexora_stats AS

SELECT

  (
    SELECT COUNT(*)
    FROM pages
  ) AS total_pages,

  (
    SELECT COUNT(*)
    FROM crawl_queue
  ) AS total_queue,

  (
    SELECT COUNT(*)
    FROM crawl_queue
    WHERE status = 'pending'
  ) AS pending_queue,

  (
    SELECT COUNT(*)
    FROM crawl_queue
    WHERE status = 'processing'
  ) AS processing_queue,

  (
    SELECT COUNT(*)
    FROM crawl_queue
    WHERE status = 'done'
  ) AS completed_queue,

  (
    SELECT COUNT(*)
    FROM crawl_queue
    WHERE status = 'failed'
  ) AS failed_queue,

  (
    SELECT COUNT(*)
    FROM page_links
  ) AS total_links;


INSERT INTO crawl_queue(
  url,
  status,
  priority
)

VALUES

(
  'https://www.wikipedia.org/',
  'pending',
  100
),

(
  'https://www.w3.org/',
  'pending',
  100
),

(
  'https://www.iana.org/',
  'pending',
  100
),

(
  'https://www.mozilla.org/',
  'pending',
  100
),

(
  'https://archive.org/',
  'pending',
  90
),

(
  'https://www.britannica.com/',
  'pending',
  90
),

(
  'https://github.com/',
  'pending',
  80
),

(
  'https://www.india.gov.in/',
  'pending',
  100
),

(
  'https://assam.gov.in/',
  'pending',
  100
)

ON CONFLICT(url)
DO NOTHING;
