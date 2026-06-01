-- 007_cooling_off.sql
-- Adds the "cooling off" flag used by the follow-up engine. When true, the UI
-- offers a wider check-in cadence (6 weeks / 2-3 months) instead of monthly
-- nudges, so a quiet lead isn't over-contacted.
--
-- Run ONCE in Supabase → SQL Editor → New query → Run. Safe to re-run.
-- Everything else in the follow-up feature works without this; only the
-- cooling-off toggle needs it (the UI hides the toggle until the column exists).

alter table clients add column if not exists cooling_off boolean not null default false;

-- Tell PostgREST to refresh its schema cache so the app sees the column.
notify pgrst, 'reload schema';
