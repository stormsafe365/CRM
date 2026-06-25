-- 013_order_details.sql
-- When a lead officially orders (contract signed + deposit placed), we capture
-- the four scheduling inputs the Follow-Up HQ needs to auto-build the timeline:
-- order date, manufacturer, engineered-plan type, and install lead-time bucket.
-- (County already lives on clients.) These flow to the calendar via the CRM
-- bridge, so the order is entered once on the client portal and nowhere else.
-- Safe to re-run.

alter table clients add column if not exists order_date   date;
alter table clients add column if not exists order_mfr    text;   -- CCI | CA | SBS
alter table clients add column if not exists order_plan   text;   -- generic | site | asbuilt
alter table clients add column if not exists order_bucket text;   -- install lead, e.g. '8-10'

-- Keep plan type to the three engineered-plan options the scheduler understands.
alter table clients drop constraint if exists clients_order_plan_check;
alter table clients add constraint clients_order_plan_check
  check (order_plan is null or order_plan in ('generic', 'site', 'asbuilt'));
