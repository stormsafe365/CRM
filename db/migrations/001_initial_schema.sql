-- =====================================================================
-- StormSafe Steel CRM — Initial Schema Migration
-- File:    001_initial_schema.sql
-- Date:    2026-05-15
-- Purpose: Creates all tables, enums, triggers, and security policies
--          for the StormSafe CRM. Run ONCE on a fresh Supabase project.
-- =====================================================================
-- Re-run safe? NO. Uses CREATE TYPE which fails on second run.
-- If you need to start over: drop the database and reprovision, or
-- write a 002_*.sql that adds/alters rather than recreates.
-- =====================================================================


-- =====================================================================
-- SECTION 1: ENUMS
-- =====================================================================
-- Postgres enums give us type-safe dropdowns at the DB layer. If the
-- app tries to insert a value not in the list, the DB rejects it.
-- This prevents typos like "qutoed" from silently breaking the kanban.
-- Adding a new value later is a one-liner: ALTER TYPE x ADD VALUE 'y';
-- =====================================================================

-- Where the lead came from. Free-text 'source_detail' column on clients
-- captures specifics (e.g. which Facebook campaign) without polluting
-- this list. Split facebook/instagram even though they're both Meta —
-- they perform differently and we want the breakdown.
CREATE TYPE lead_source AS ENUM (
  'google_search',
  'facebook',
  'instagram',
  'referral_customer',   -- referred by a past customer
  'referral_partner',    -- referred by a contractor or dealer
  'drive_by',            -- saw the sign / saw a building in person
  'event',               -- home show, trade show, fair
  'other'
);

-- Pipeline stages. Order matters — used as default sort on the Kanban.
-- 'lost' and 'cancelled' are hidden from the main board (clutter +
-- emotionally bad to stare at) but accessible via filter/archive tab.
--   lost      = ghosted or chose a competitor; never committed
--   cancelled = was active and fell apart (permit denial, financing died)
CREATE TYPE client_status AS ENUM (
  'new_lead',
  'contacted',
  'quoted',
  'follow_up',
  'deposit_pending',     -- verbal yes, no money received yet
  'deposit_paid',        -- money received
  'ordered',             -- order placed with manufacturer
  'scheduled',           -- install date is on the calendar
  'installed',           -- building is up
  'done',                -- fully complete, final payment in
  'lost',
  'cancelled'
);

-- Quote lifecycle. Independent of client_status because a client can
-- have multiple quotes in different states simultaneously (old quote
-- 'superseded', new revision 'sent', etc.).
--   verbal_accept = customer said yes by phone/text/email, no money yet
--   deposit_paid  = money actually received
--   superseded    = replaced by a newer revision (parent_quote_id chain)
--   expired       = past valid_through date; auto-flipped by cron job
CREATE TYPE quote_status AS ENUM (
  'draft',
  'sent',
  'verbal_accept',
  'deposit_paid',
  'declined',
  'superseded',
  'expired'
);

-- Which manufacturer the quote was built with. INTERNAL ONLY — customer
-- PDFs always show StormSafe branding regardless of this value.
CREATE TYPE manufacturer_type AS ENUM (
  'ca',    -- Carports Anywhere
  'cci',   -- CCI
  'other'  -- placeholder for future manufacturers
);

-- Types of entries in the activity log. Manual types (note/call/email/
-- meeting) are user-entered. The rest are auto-created by triggers
-- when the corresponding event fires.
CREATE TYPE activity_type AS ENUM (
  'note',                  -- manual: freeform text entry
  'call',                  -- manual: logged a phone call
  'email',                 -- manual: logged an email exchange
  'meeting',               -- manual: site visit / in-person
  'status_change',         -- auto: client.status changed
  'quote_created',         -- auto: new quote attached to this client
  'quote_status_change',   -- auto: a quote's status changed
  'follow_up_set',         -- auto: follow_up_date was set or changed
  'follow_up_completed'    -- auto: follow_up_date was cleared
);

-- App-level role. 'admin' reserved for future use (e.g. user management
-- screen); 'rep' is the default for both Jenna and her partner.
CREATE TYPE user_role AS ENUM ('admin', 'rep');


-- =====================================================================
-- SECTION 2: USERS TABLE
-- =====================================================================
-- Supabase manages authentication in its own auth.users table (locked
-- down, we shouldn't add columns to it). This public.users table
-- mirrors auth.users 1-to-1 via the shared uuid, and holds OUR app
-- profile fields (display_name, role).
--
-- A trigger at the bottom of this file auto-creates a row here whenever
-- someone signs up through Supabase auth, so you never have to insert
-- into this table manually.
-- =====================================================================

CREATE TABLE users (
  id           uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  email        text NOT NULL,
  role         user_role NOT NULL DEFAULT 'rep',
  created_at   timestamptz NOT NULL DEFAULT now()
);


-- =====================================================================
-- SECTION 3: CLIENTS TABLE
-- =====================================================================
-- The central table. Every quote and every activity links back here.
--
-- Assignment model: primary_rep is required, secondary_rep is optional.
-- 99% of clients are owned by one rep. The optional second slot covers
-- the occasional shared deal (one rep takes the inquiry, the other does
-- the site visit) without needing a full junction table.
--
-- notes vs activities: 'notes' is a long-form freeform field for "what
-- you generally know about this client" (e.g. "prefers texts, allergic
-- to phone calls, brother also bought from us in 2023"). The activities
-- table is the dated timeline of specific events. Don't confuse them.
-- =====================================================================

CREATE TABLE clients (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  email           text,
  phone           text,
  address_line    text,
  city            text,
  county          text,
  state           text,
  zip             text,
  source          lead_source,
  source_detail   text,                              -- free-text specifics, e.g. "FB Memorial Day ad"
  status          client_status NOT NULL DEFAULT 'new_lead',
  primary_rep     uuid NOT NULL REFERENCES users(id),
  secondary_rep   uuid REFERENCES users(id),
  follow_up_date  date,                              -- null = no follow-up scheduled
  notes           text,                              -- long-form, separate from activity log
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Indexes for the common query patterns:
--   - kanban board: "give me all clients grouped by status"
--   - dashboard:    "give me clients with follow-ups due today/this week"
--   - my pipeline:  "give me all clients where I'm primary_rep"
CREATE INDEX idx_clients_status         ON clients(status);
CREATE INDEX idx_clients_follow_up_date ON clients(follow_up_date) WHERE follow_up_date IS NOT NULL;
CREATE INDEX idx_clients_primary_rep    ON clients(primary_rep);


-- =====================================================================
-- SECTION 4: QUOTES TABLE
-- =====================================================================
-- One client → many quotes. Quote revisions ("redo it with a bigger
-- lean-to") are stored as NEW rows with parent_quote_id pointing to
-- the original. This keeps the original intact for history.
--
-- payload_json holds the COMPLETE quote state from the builder (every
-- field, every accessory, every price). Always stored. This is what
-- lets us regenerate the PDF on demand — if we change the PDF template
-- six months from now, every old quote renders with the new look.
--
-- pdf_snapshot_url is the EXCEPTION: when a quote moves to 'sent', we
-- freeze a copy of the PDF as it went out to the customer. That way,
-- if the template later changes, we still have legal/audit proof of
-- exactly what the customer received.
--
-- quote_number is UNIQUE — the builders generate SS-YYYY-NNNNN. The
-- CRM trusts whatever the builder produces and rejects duplicates.
-- =====================================================================

CREATE TABLE quotes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  quote_number      text NOT NULL UNIQUE,             -- SS-YYYY-NNNNN, from builder
  manufacturer      manufacturer_type NOT NULL,
  building_summary  text,                             -- human-readable: "30x40x12 vertical, 1 RU"
  total_amount      numeric(12, 2),
  deposit_amount    numeric(12, 2),
  balance_amount    numeric(12, 2),
  status            quote_status NOT NULL DEFAULT 'draft',
  valid_through     date,                             -- null = no expiry; drives auto-expire job
  parent_quote_id   uuid REFERENCES quotes(id),       -- null = original; set on revisions
  payload_json      jsonb NOT NULL,                   -- full quote state for regen
  pdf_snapshot_url  text,                             -- frozen PDF; populated only on status='sent'
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL REFERENCES users(id)
);

CREATE INDEX idx_quotes_client_id     ON quotes(client_id);
CREATE INDEX idx_quotes_status        ON quotes(status);
CREATE INDEX idx_quotes_valid_through ON quotes(valid_through) WHERE valid_through IS NOT NULL;


-- =====================================================================
-- SECTION 5: ACTIVITIES TABLE
-- =====================================================================
-- Per-client chronological timeline. Mix of MANUAL entries (you typed
-- a note, logged a call) and AUTO entries (triggers fire on status
-- changes, quote events, etc.).
--
-- 'metadata' jsonb holds structured context for auto-entries:
--   status_change       → {"from": "quoted", "to": "follow_up"}
--   quote_created       → {"quote_id": "...", "quote_number": "SS-2026-80362"}
--   quote_status_change → {"quote_id": "...", "from": "draft", "to": "sent"}
--   follow_up_set       → {"date": "2026-05-22"}
--
-- Manual entries (note/call/email/meeting) typically leave metadata
-- null and put everything readable in 'body'.
--
-- We over-log on purpose: storage is cheap, missing context is expensive.
-- =====================================================================

CREATE TABLE activities (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  type        activity_type NOT NULL,
  body        text,
  metadata    jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid REFERENCES users(id)             -- nullable: system-generated entries
);

-- Composite index: "give me this client's timeline newest-first" is the
-- only query we run against this table. Single index covers it.
CREATE INDEX idx_activities_client_id_created_at ON activities(client_id, created_at DESC);


-- =====================================================================
-- SECTION 6: updated_at TRIGGER
-- =====================================================================
-- Standard Postgres pattern. Whenever a row in clients or quotes is
-- updated, the updated_at column is automatically set to now(). Saves
-- us from having to remember to set it in every UPDATE.
-- =====================================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_clients_updated_at
  BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_quotes_updated_at
  BEFORE UPDATE ON quotes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- =====================================================================
-- SECTION 7: ACTIVITY AUTO-LOG TRIGGERS
-- =====================================================================
-- These triggers write activity rows automatically when meaningful
-- events happen. The app doesn't have to remember to log them.
--
-- SECURITY DEFINER means the function runs with the privileges of the
-- function owner (the DB superuser), not the calling user. This lets
-- the trigger insert into activities even if the user's RLS policy
-- would otherwise block direct inserts.
-- =====================================================================

-- Log client status changes.
CREATE OR REPLACE FUNCTION log_client_status_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO activities (client_id, type, body, metadata, created_by)
    VALUES (
      NEW.id,
      'status_change',
      'Status changed from ' || OLD.status::text || ' to ' || NEW.status::text,
      jsonb_build_object('from', OLD.status::text, 'to', NEW.status::text),
      auth.uid()
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_clients_log_status_change
  AFTER UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION log_client_status_change();

-- Log follow-up date set / changed / cleared.
CREATE OR REPLACE FUNCTION log_follow_up_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.follow_up_date IS DISTINCT FROM NEW.follow_up_date THEN
    IF NEW.follow_up_date IS NULL THEN
      INSERT INTO activities (client_id, type, body, metadata, created_by)
      VALUES (NEW.id, 'follow_up_completed', 'Follow-up cleared', NULL, auth.uid());
    ELSE
      INSERT INTO activities (client_id, type, body, metadata, created_by)
      VALUES (
        NEW.id,
        'follow_up_set',
        'Follow-up set for ' || NEW.follow_up_date::text,
        jsonb_build_object('date', NEW.follow_up_date::text),
        auth.uid()
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_clients_log_follow_up_change
  AFTER UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION log_follow_up_change();

-- Log quote creation.
CREATE OR REPLACE FUNCTION log_quote_created()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO activities (client_id, type, body, metadata, created_by)
  VALUES (
    NEW.client_id,
    'quote_created',
    'Quote ' || NEW.quote_number || ' created',
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

CREATE TRIGGER trg_quotes_log_created
  AFTER INSERT ON quotes
  FOR EACH ROW EXECUTE FUNCTION log_quote_created();

-- Log quote status changes.
CREATE OR REPLACE FUNCTION log_quote_status_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO activities (client_id, type, body, metadata, created_by)
    VALUES (
      NEW.client_id,
      'quote_status_change',
      'Quote ' || NEW.quote_number || ' status: ' || OLD.status::text || ' → ' || NEW.status::text,
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

CREATE TRIGGER trg_quotes_log_status_change
  AFTER UPDATE ON quotes
  FOR EACH ROW EXECUTE FUNCTION log_quote_status_change();


-- =====================================================================
-- SECTION 8: AUTO-EXPIRE QUOTES (scheduled job)
-- =====================================================================
-- Runs daily at 2am. Any quote past its valid_through date that's still
-- in an "in-progress" state (draft / sent / verbal_accept) flips to
-- 'expired'. Final states (deposit_paid / declined / superseded /
-- expired) are left alone — those decisions override the date.
--
-- Uses pg_cron, which Supabase supports but requires you to enable
-- once in the dashboard: Database → Extensions → search "pg_cron" →
-- toggle on. If pg_cron isn't enabled when this migration runs, the
-- final cron.schedule() call below will fail — see setup steps.
-- =====================================================================

CREATE OR REPLACE FUNCTION expire_overdue_quotes()
RETURNS void AS $$
BEGIN
  UPDATE quotes
  SET status = 'expired'
  WHERE valid_through < CURRENT_DATE
    AND status IN ('draft', 'sent', 'verbal_accept');
END;
$$ LANGUAGE plpgsql;

-- Cron format: minute hour day-of-month month day-of-week
-- '0 2 * * *' = 2:00 AM every day, UTC.
SELECT cron.schedule(
  'expire-overdue-quotes',
  '0 2 * * *',
  $$SELECT expire_overdue_quotes()$$
);


-- =====================================================================
-- SECTION 9: ROW LEVEL SECURITY (RLS)
-- =====================================================================
-- Supabase exposes the DB to the frontend via a REST API. Without RLS,
-- anyone with the public anon key could read or modify any row.
-- RLS locks this down — only authenticated users matching the policies
-- can perform operations.
--
-- For a two-person team where both reps see all data, the policies
-- are simple: any authenticated user has full access to clients,
-- quotes, and activities. If we later add reps with limited visibility,
-- we replace these policies with stricter ones.
-- =====================================================================

ALTER TABLE users      ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients    ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotes     ENABLE ROW LEVEL SECURITY;
ALTER TABLE activities ENABLE ROW LEVEL SECURITY;

-- USERS: any authenticated user can read all profiles (needed to show
-- "primary_rep: Jenna" in dropdowns and detail views). Users can only
-- update their own row (so nobody can promote themselves to admin).
CREATE POLICY "users_select_all_authenticated"
  ON users FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "users_update_own"
  ON users FOR UPDATE
  TO authenticated USING (auth.uid() = id);

-- CLIENTS / QUOTES / ACTIVITIES: full access for any authenticated
-- user. Matches the requirement that both reps share all data.
CREATE POLICY "clients_full_access_authenticated"
  ON clients FOR ALL
  TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "quotes_full_access_authenticated"
  ON quotes FOR ALL
  TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "activities_full_access_authenticated"
  ON activities FOR ALL
  TO authenticated USING (true) WITH CHECK (true);


-- =====================================================================
-- SECTION 10: AUTO-CREATE USER PROFILE ON SIGNUP
-- =====================================================================
-- When a new user signs up via Supabase auth, automatically insert
-- their row into public.users. display_name comes from signup metadata
-- if provided, otherwise falls back to the email prefix.
--
-- Why: avoids a chicken-and-egg problem where the user exists in
-- auth.users but not in public.users, breaking foreign keys to
-- primary_rep, created_by, etc.
-- =====================================================================

CREATE OR REPLACE FUNCTION handle_new_auth_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, email, display_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    'rep'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_auth_user();


-- =====================================================================
-- END OF MIGRATION 001
-- =====================================================================
-- Verification: after running, you should see 4 tables in the Table
-- Editor: users, clients, quotes, activities. Run a quick sanity check:
--
--   SELECT table_name FROM information_schema.tables
--   WHERE table_schema = 'public' ORDER BY table_name;
--
-- Expected output: activities, clients, quotes, users
-- =====================================================================
