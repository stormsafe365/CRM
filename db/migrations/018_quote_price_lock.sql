-- 018_quote_price_lock.sql
-- Reopened-quote price lock (owner 9/30/26: "make sure i can reopen that quote
-- exactly as it was"). NOT applied yet — run it in the Supabase SQL editor when
-- ready. The CRM works without it:
--   * without step 1, Finish Revision leaves the quote's status as it was
--     (the REVISED badge just doesn't appear) and says so;
--   * without step 2, price changes are still recorded in each quote's
--     payload_json.price_history — this adds a database-side audit trail that
--     also catches edits made outside the builder (e.g. the quote form).
-- Safe to re-run.

-- ═══════════════════════════════════════════════════════════════════════
-- STEP 1 — run this line ON ITS OWN first (Postgres needs a new enum value
-- committed before anything can use it).
-- ═══════════════════════════════════════════════════════════════════════
alter type quote_status add value if not exists 'revised';


-- ═══════════════════════════════════════════════════════════════════════
-- STEP 2 — then run everything below.
-- Audit trail: one row every time a quote's total / deposit / balance or
-- status changes, with the OLD and NEW values and who made the change.
-- ═══════════════════════════════════════════════════════════════════════
create table if not exists quote_price_events (
  id            uuid primary key default gen_random_uuid(),
  quote_id      uuid not null references quotes(id) on delete cascade,
  client_id     uuid,
  quote_number  text,
  changed_at    timestamptz not null default now(),
  changed_by    uuid,
  old_total     numeric(12, 2),
  old_deposit   numeric(12, 2),
  old_balance   numeric(12, 2),
  new_total     numeric(12, 2),
  new_deposit   numeric(12, 2),
  new_balance   numeric(12, 2),
  old_status    text,
  new_status    text,
  old_pdf       text,
  new_pdf       text
);

create index if not exists idx_quote_price_events_quote on quote_price_events(quote_id, changed_at desc);

create or replace function log_quote_price_event()
returns trigger as $$
begin
  if old.total_amount   is distinct from new.total_amount
  or old.deposit_amount is distinct from new.deposit_amount
  or old.balance_amount is distinct from new.balance_amount
  or old.status         is distinct from new.status then
    insert into quote_price_events (
      quote_id, client_id, quote_number, changed_by,
      old_total, old_deposit, old_balance,
      new_total, new_deposit, new_balance,
      old_status, new_status, old_pdf, new_pdf
    ) values (
      new.id, new.client_id, new.quote_number, auth.uid(),
      old.total_amount, old.deposit_amount, old.balance_amount,
      new.total_amount, new.deposit_amount, new.balance_amount,
      old.status::text, new.status::text, old.pdf_snapshot_url, new.pdf_snapshot_url
    );
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists trg_quotes_price_event on quotes;
create trigger trg_quotes_price_event
  after update on quotes
  for each row execute function log_quote_price_event();

-- Readable by the team; written only by the trigger (security definer), so
-- no insert / update / delete policy for app users.
alter table quote_price_events enable row level security;
drop policy if exists "quote_price_events_select_authenticated" on quote_price_events;
create policy "quote_price_events_select_authenticated"
  on quote_price_events for select
  to authenticated using (true);
