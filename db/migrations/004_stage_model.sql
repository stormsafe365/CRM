-- =====================================================================
-- StormSafe CRM — Migration 004: Two-track stage model
-- File:    004_stage_model.sql
-- Purpose: Add the 'contract_sent' sales stage and a separate
--          project_stage track for clients who have ordered (deposit
--          paid + contract signed).
-- How to run: Supabase dashboard → SQL Editor → paste → Run.
-- Re-run safe? Yes (IF NOT EXISTS guards).
-- =====================================================================
-- NOTE: If the first line errors with "ALTER TYPE ... cannot run inside
-- a transaction block", run that ONE line by itself first, then run the
-- rest. (Some SQL editors wrap multi-statement runs in a transaction.)
-- =====================================================================

-- 1) New SALES stage: Contract Sent (between Follow-Up and Ordered).
ALTER TYPE client_status ADD VALUE IF NOT EXISTS 'contract_sent';

-- 2) PROJECT track. Only meaningful once status = 'ordered'.
--    Stored as text so the stage list can be tweaked without a migration.
--    Valid values (enforced in the app): ordered, engineering, permitting,
--    scheduling, installed, revisions_needed.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS project_stage text;

-- Helpful index for the dashboard's "Ordered / in-project" breakdown.
CREATE INDEX IF NOT EXISTS idx_clients_project_stage
  ON clients(project_stage) WHERE project_stage IS NOT NULL;

-- =====================================================================
-- END OF MIGRATION 004
-- =====================================================================
