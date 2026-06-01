-- 012_client_notes.sql
-- Private internal notes for the team (Jenna & Josh) — a scratchpad on each
-- lead, separate from the activity log and follow-ups. Categorized: call /
-- project / permit / general. (Applied to production via Management API.)

create table if not exists client_notes (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references clients(id) on delete cascade,
  category   text not null default 'general' check (category in ('call', 'project', 'permit', 'general')),
  body       text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  created_by uuid
);

create index if not exists idx_client_notes_client on client_notes(client_id);
grant all on table client_notes to anon, authenticated, service_role;
