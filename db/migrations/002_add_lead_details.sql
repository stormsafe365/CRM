-- =====================================================================
-- StormSafe Steel CRM — Migration 002: Lead Details
-- File:    002_add_lead_details.sql
-- Date:    2026-05-16
-- Purpose: Adds first_contact_date and building inquiry fields to the
--          clients table. Used until the CA/CCI quote builders are
--          integrated and quotes flow in automatically.
-- =====================================================================
-- Re-run safe? Mostly. ALTER TABLE ADD COLUMN IF NOT EXISTS is safe to
-- re-run. Run this once in the Supabase SQL Editor.
-- =====================================================================

-- Date we first spoke with the lead. Used for "how long has this been
-- in the pipeline" and follow-up cadence. Auto-set to today on new
-- client creation by the app, but editable for retroactive entries.
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS first_contact_date date;

-- Free-text dimensions string, e.g. "30x40x12" or "30W x 40L x 12H".
-- Free text rather than separate width/length/height columns because
-- early-stage leads often don't have firm numbers — they say "around
-- 30 by 40" and we want to capture that as-is.
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS building_size text;

-- Building style/type. Stored as free text (not an enum) so the list
-- of options can be tweaked in the app without DB migrations. The
-- dropdown options live in src/lib/constants.js.
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS building_type text;

-- Notes on extras: roll-up doors, windows, insulation, walk-in doors,
-- color choices, etc. Catch-all for anything you'd want to remember
-- before a formal quote exists.
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS building_features text;

-- Ballpark price the customer mentioned or you quoted verbally. Stored
-- as text (not numeric) so we can capture ranges like "$8k-$12k" or
-- "around 10,000" without forcing a specific number.
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS estimated_price_range text;

-- =====================================================================
-- END OF MIGRATION 002
-- =====================================================================
