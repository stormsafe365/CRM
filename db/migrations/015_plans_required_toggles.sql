-- 015_plans_required_toggles.sql
-- Milestone-driven follow-up engine inputs.
--  • Widen order_plan ("Plans Required") from the old 3 values to 6.
--  • Add Exempt (no permit needed) + Site Ready toggles.
-- Safe to re-run.

-- order_plan now holds: none | masterfiles | generic | generic_stamped | sitespecific | asbuilt
alter table clients drop constraint if exists clients_order_plan_check;
alter table clients add constraint clients_order_plan_check
  check (order_plan is null or order_plan in
    ('none','masterfiles','generic','generic_stamped','sitespecific','asbuilt',
     -- keep the legacy values valid so existing rows don't violate the check
     'site','asbuilt'));

alter table clients add column if not exists order_exempt    boolean not null default false;
alter table clients add column if not exists order_site_ready boolean not null default false;
