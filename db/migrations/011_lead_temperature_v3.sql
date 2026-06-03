-- 011_lead_temperature_v3.sql
-- Expand the lead-temperature thermometer to the 6 stops the UI now offers:
-- cold → warm → hot → ready → pending_deposit → ordered.
-- The old CHECK constraint (010) only allowed the first 4, so dragging the knob
-- to "Pending Deposit" or "Ordered" was silently rejected by the database and
-- the knob snapped back. This widens the allowed set. Idempotent — safe to
-- re-run. Run once in the Supabase SQL Editor.

alter table clients drop constraint if exists clients_lead_temperature_check;

alter table clients add constraint clients_lead_temperature_check
  check (lead_temperature is null or lead_temperature in
    ('cold', 'warm', 'hot', 'ready', 'pending_deposit', 'ordered'));

-- make the new value visible to PostgREST immediately
notify pgrst, 'reload schema';
