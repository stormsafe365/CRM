-- =====================================================================
-- StormSafe CRM — Migration 005: Deposit/ACH payment cleared flag
-- Purpose: track whether an ordered client's deposit payment has cleared.
-- How to run: Supabase dashboard → SQL Editor → paste → Run.
-- Re-run safe? Yes (IF NOT EXISTS).
-- =====================================================================

alter table clients
  add column if not exists payment_cleared boolean not null default false;

notify pgrst, 'reload schema';

-- =====================================================================
-- END OF MIGRATION 005
-- =====================================================================
