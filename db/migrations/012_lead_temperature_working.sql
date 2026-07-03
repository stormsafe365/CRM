-- 012_lead_temperature_working.sql
-- Adds a "working" stop to the lead-temperature thermometer, between Warm
-- (attempting contact) and Hot — a spoken-to lead that's being worked but isn't
-- hot yet. The 011 CHECK constraint only allowed the prior 6 values, so dragging
-- the knob to "Working" was silently rejected and snapped back to Hot.
-- Idempotent — safe to re-run. Run once in the Supabase SQL Editor.

alter table clients drop constraint if exists clients_lead_temperature_check;

alter table clients add constraint clients_lead_temperature_check
  check (lead_temperature is null or lead_temperature in
    ('cold', 'warm', 'working', 'hot', 'ready', 'pending_deposit', 'ordered'));

-- make the new value visible to PostgREST immediately
notify pgrst, 'reload schema';
