-- 009_lead_temperature.sql
-- Manual lead temperature (Hot / Warm / Cold), set by the rep on the lead.
-- Replaces the mockup's auto "lead score" — we deliberately do NOT fabricate
-- quote-open counts or website-visit data we don't actually track. Nullable:
-- an unset lead simply shows no temperature.

alter table clients
  add column if not exists lead_temperature text
  check (lead_temperature is null or lead_temperature in ('hot', 'warm', 'cold'));
