-- =====================================================================
-- StormSafe Steel CRM — Migration 003: Quotes (manual entry + PDFs)
-- File:    003_quotes_setup.sql
-- Date:    2026-05-16
-- Purpose: Relaxes constraints on quotes table so manual entries work
--          (without a builder payload), adds a few new columns,
--          and creates a Storage bucket for uploaded PDFs.
-- =====================================================================
-- Re-run safe? Mostly. Uses IF NOT EXISTS / ON CONFLICT / CREATE OR
-- REPLACE wherever possible. Safe to re-run.
-- =====================================================================


-- ---------------------------------------------------------------------
-- SECTION 1: Relax existing constraints
-- ---------------------------------------------------------------------
-- The original schema assumed quotes always came from the builder
-- (so quote_number, manufacturer, payload_json were all required).
-- Manual entry doesn't have those, so we make them optional.
-- The UNIQUE constraint on quote_number stays in place — but Postgres
-- allows multiple NULLs in a unique column, so unfilled numbers don't
-- collide.

ALTER TABLE quotes ALTER COLUMN quote_number DROP NOT NULL;
ALTER TABLE quotes ALTER COLUMN manufacturer DROP NOT NULL;
ALTER TABLE quotes ALTER COLUMN payload_json DROP NOT NULL;


-- ---------------------------------------------------------------------
-- SECTION 2: New columns
-- ---------------------------------------------------------------------

-- The date on the quote itself (when it was sent / dated), distinct
-- from created_at (when the record was entered into the CRM).
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS quote_date date;

-- Building size for this specific quote. Lives on the quote (not the
-- client) because a quote revision might change the size, and we want
-- the history preserved per-quote.
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS building_size text;

-- Per-quote freeform notes. Different from client notes — these are
-- specific to "this quote in particular" (e.g. "v2 with bigger lean-to").
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS notes text;


-- ---------------------------------------------------------------------
-- SECTION 3: Update activity log triggers to handle null quote_number
-- ---------------------------------------------------------------------
-- The existing triggers concatenate quote_number into the log message.
-- If it's null, we'd get "Quote null created" which looks broken.
-- COALESCE provides a fallback.

CREATE OR REPLACE FUNCTION log_quote_created()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO activities (client_id, type, body, metadata, created_by)
  VALUES (
    NEW.client_id,
    'quote_created',
    'Quote ' || COALESCE(NEW.quote_number, '(no #)') || ' created',
    jsonb_build_object(
      'quote_id',     NEW.id,
      'quote_number', NEW.quote_number,
      'total_amount', NEW.total_amount
    ),
    NEW.created_by
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION log_quote_status_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO activities (client_id, type, body, metadata, created_by)
    VALUES (
      NEW.client_id,
      'quote_status_change',
      'Quote ' || COALESCE(NEW.quote_number, '(no #)') || ' status: ' || OLD.status::text || ' → ' || NEW.status::text,
      jsonb_build_object(
        'quote_id',     NEW.id,
        'quote_number', NEW.quote_number,
        'from',         OLD.status::text,
        'to',           NEW.status::text
      ),
      auth.uid()
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ---------------------------------------------------------------------
-- SECTION 4: Storage bucket for quote PDFs
-- ---------------------------------------------------------------------
-- Supabase Storage. We create a private bucket (public=false) and
-- generate signed URLs on the client side for viewing. Signed URLs
-- expire automatically (default 1 hour) — even if someone shares the
-- link, it stops working quickly.
--
-- Bucket name: quote-pdfs

INSERT INTO storage.buckets (id, name, public)
VALUES ('quote-pdfs', 'quote-pdfs', false)
ON CONFLICT (id) DO NOTHING;


-- ---------------------------------------------------------------------
-- SECTION 5: Storage policies
-- ---------------------------------------------------------------------
-- Allow authenticated users to read, upload, update, and delete
-- objects in the quote-pdfs bucket. Same logic as the clients/quotes/
-- activities tables — for a two-person team, both reps have full access.
--
-- Note: storage.objects already has RLS enabled by default in Supabase.

DO $$
BEGIN
  -- SELECT
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'quote_pdfs_authenticated_select'
  ) THEN
    CREATE POLICY "quote_pdfs_authenticated_select"
      ON storage.objects FOR SELECT
      TO authenticated
      USING (bucket_id = 'quote-pdfs');
  END IF;

  -- INSERT
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'quote_pdfs_authenticated_insert'
  ) THEN
    CREATE POLICY "quote_pdfs_authenticated_insert"
      ON storage.objects FOR INSERT
      TO authenticated
      WITH CHECK (bucket_id = 'quote-pdfs');
  END IF;

  -- UPDATE
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'quote_pdfs_authenticated_update'
  ) THEN
    CREATE POLICY "quote_pdfs_authenticated_update"
      ON storage.objects FOR UPDATE
      TO authenticated
      USING (bucket_id = 'quote-pdfs');
  END IF;

  -- DELETE
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'quote_pdfs_authenticated_delete'
  ) THEN
    CREATE POLICY "quote_pdfs_authenticated_delete"
      ON storage.objects FOR DELETE
      TO authenticated
      USING (bucket_id = 'quote-pdfs');
  END IF;
END $$;


-- =====================================================================
-- END OF MIGRATION 003
-- =====================================================================
