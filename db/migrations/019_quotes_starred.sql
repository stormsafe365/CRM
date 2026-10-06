-- 019_quotes_starred.sql
-- Starred quote (owner 10/6/26): one quote per lead can be starred — the one
-- the client is leaning towards / ordered. It sorts first in the quote lists
-- and is the quote the Document Hub's "Open Layout" reflects.
-- NOT applied yet — run it in the Supabase SQL editor when ready. The CRM works
-- without it: the star buttons simply stay hidden until the column exists, and
-- Open Layout uses the lead's newest quote. Safe to re-run.

alter table quotes add column if not exists starred boolean default false;
-- (017_soft_delete.sql adds this too — repeated so this file runs on its own.)
alter table quotes add column if not exists deleted_at timestamptz;

-- At most ONE starred (non-deleted) quote per lead. The app unstars the lead's
-- other quotes before starring a new one.
create unique index if not exists quotes_one_starred_per_client
  on quotes (client_id)
  where starred and deleted_at is null;
