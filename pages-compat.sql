-- HEXORA compatibility columns for the existing Neon PostgreSQL `pages` table.
-- Run this against Neon before deploying the server. This does not delete data.
CREATE TABLE IF NOT EXISTS pages (
  id BIGSERIAL PRIMARY KEY,
  url TEXT UNIQUE,
  title TEXT,
  description TEXT,
  content TEXT,
  content_hash TEXT,
  word_count INTEGER NOT NULL DEFAULT 0,
  language TEXT DEFAULT 'unknown',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE pages ADD COLUMN IF NOT EXISTS canonical_url TEXT;
ALTER TABLE pages ADD COLUMN IF NOT EXISTS domain TEXT;
ALTER TABLE pages ADD COLUMN IF NOT EXISTS author TEXT;
ALTER TABLE pages ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE pages ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;
ALTER TABLE pages ADD COLUMN IF NOT EXISTS last_crawled_at TIMESTAMPTZ;
ALTER TABLE pages ADD COLUMN IF NOT EXISTS authority_score DOUBLE PRECISION DEFAULT 0;
ALTER TABLE pages ADD COLUMN IF NOT EXISTS popularity_score DOUBLE PRECISION DEFAULT 0;
ALTER TABLE pages ADD COLUMN IF NOT EXISTS quality_score DOUBLE PRECISION DEFAULT 0;
ALTER TABLE pages ADD COLUMN IF NOT EXISTS inbound_links INTEGER DEFAULT 0;
ALTER TABLE pages ADD COLUMN IF NOT EXISTS excerpt TEXT;
ALTER TABLE pages ADD COLUMN IF NOT EXISTS r2_key TEXT;
ALTER TABLE pages ADD COLUMN IF NOT EXISTS crawl_status TEXT DEFAULT 'done';
ALTER TABLE pages ADD COLUMN IF NOT EXISTS search_vector TSVECTOR;
ALTER TABLE pages ADD COLUMN IF NOT EXISTS image_items JSONB DEFAULT '[]'::jsonb;
ALTER TABLE pages ADD COLUMN IF NOT EXISTS video_items JSONB DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS pages_search_vector_idx ON pages USING GIN (search_vector);
CREATE INDEX IF NOT EXISTS pages_last_crawled_idx ON pages (last_crawled_at DESC);
CREATE INDEX IF NOT EXISTS pages_domain_idx ON pages (domain);

-- Populate full-text search vectors for existing rows; safe to re-run.
UPDATE pages
SET search_vector = to_tsvector('simple',
  COALESCE(title,'') || ' ' || COALESCE(description,'') || ' ' || COALESCE(content,'') || ' ' || COALESCE(url,''))
WHERE search_vector IS NULL;
