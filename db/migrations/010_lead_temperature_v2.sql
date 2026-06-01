-- 010_lead_temperature_v2.sql
-- Expand lead temperature to 4 levels (cold → warm → hot → ready-to-close) and
-- track who changed it and when, for the interactive thermometer control.
-- (Already applied to production via the Management API on 2026-06-01.)

alter table clients drop constraint if exists clients_lead_temperature_check;

alter table clients add constraint clients_lead_temperature_check
  check (lead_temperature is null or lead_temperature in ('cold', 'warm', 'hot', 'ready'));

alter table clients add column if not exists lead_temp_updated_at timestamptz;
alter table clients add column if not exists lead_temp_updated_by uuid;
