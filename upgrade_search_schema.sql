

-- HEXORA SEARCH ENGINE DATABASE UPGRADE
-- Run this once in Supabase SQL Editor.
-- Do not delete existing pages or crawl data.

alter table public.pages
  add column if not exists last_crawled_at timestamptz;

alter table public.pages
  add column if not exists search_vector tsvector;

create index if not exists pages_search_vector_idx
  on public.pages using gin(search_vector);

create index if not exists pages_updated_at_idx
  on public.pages(updated_at desc);

create index if not exists pages_last_crawled_idx
  on public.pages(last_crawled_at desc);

create or replace function public.hexora_update_search_vector()
returns trigger
language plpgsql
as $$
begin
  new.search_vector :=
    setweight(to_tsvector('simple', coalesce(new.title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(new.description, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(new.content, '')), 'C');

  return new;
end;
$$;

drop trigger if exists pages_search_vector_trigger
on public.pages;

create trigger pages_search_vector_trigger
before insert or update of title, description, content
on public.pages
for each row
execute function public.hexora_update_search_vector();

update public.pages
set search_vector =
    setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(description, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(content, '')), 'C')
where search_vector is null;
