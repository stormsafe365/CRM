-- 014_order_site.sql
-- Two more order details captured on "Mark as Ordered", both feeding the
-- Follow-Up HQ setup: how the building is grounded, and who handles the permit.
-- Stored as the human-readable label so it displays everywhere without mapping.
-- Safe to re-run.

alter table clients add column if not exists order_foundation text;  -- Concrete | Footers Only | Asphalt | Gravel | Directly to the ground
alter table clients add column if not exists order_permitting text;  -- Client pulling permit | Permit service for building | Permit service for building & pad | No permit needed
