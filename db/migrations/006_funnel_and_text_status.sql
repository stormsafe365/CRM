-- =====================================================================
-- StormSafe CRM — Migration 006: New funnel + text status (catch-all)
-- ---------------------------------------------------------------------
-- This ONE migration brings the database fully up to date and ENDS the
-- recurring enum-migration pain. After this, adding/renaming a sales
-- stage is a code-only change — no more "ALTER TYPE" headaches.
--
-- How to run: Supabase dashboard → SQL Editor → New query → paste this
-- WHOLE file → Run. Safe to run more than once.
-- =====================================================================

-- 1) Optional columns used by the app (no-ops if already added).
alter table clients add column if not exists project_stage   text;
alter table clients add column if not exists payment_cleared boolean not null default false;

-- 2) Convert clients.status from the rigid enum to plain text.
--    (Drop the enum default first, convert, then restore a text default.)
alter table clients alter column status drop default;
alter table clients alter column status type text using status::text;
alter table clients alter column status set default 'new_lead';

-- 3) Migrate legacy stage values into the new funnel.
update clients set status = 'working' where status in ('quoted', 'follow_up');
update clients set status = 'dead'    where status in ('lost', 'cancelled');
update clients set status = 'ordered' where status in ('deposit_pending', 'deposit_paid', 'scheduled', 'installed', 'done');

-- 4) Tell PostgREST to refresh its schema cache so the app sees changes now.
notify pgrst, 'reload schema';

-- =====================================================================
-- New funnel (stored as text in clients.status):
--   new_lead       New Lead              (not yet contacted)
--   contacted      Attempting to Contact (tried, no answer)
--   working        Working Leads         (spoken to / quoted)
--   working_hot    Working Hot Leads     (likely to move soon)
--   contract_sent  Contract Sent         (DocuSign out, awaiting deposit/sig)
--   ordered        Ordered               (deposit + signed)
--   dead           Dead
-- =====================================================================
