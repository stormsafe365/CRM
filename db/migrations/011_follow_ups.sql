-- 011_follow_ups.sql
-- Multiple, editable follow-ups per lead (replaces the single clients.follow_up_date
-- as the rich source). Each row: who it's with (client/rep/manufacturer), type,
-- purpose, details, assigned rep, date+time, status, and reminder channels.
--
-- A sync trigger keeps clients.follow_up_date / follow_up_time pointed at the
-- SOONEST pending follow-up, so the existing daily email, Today page, dashboard,
-- and timed reminders keep working unchanged — no re-homing required.
-- (Applied to production via the Management API on 2026-06-01.)

create table if not exists follow_ups (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references clients(id) on delete cascade,
  audience     text not null default 'client'  check (audience in ('client', 'rep', 'manufacturer')),
  type         text not null default 'call'    check (type in ('call', 'text', 'email', 'note')),
  purpose      text,
  details      text,
  assigned_to  uuid,
  due_date     date not null,
  due_time     time,
  status       text not null default 'pending' check (status in ('pending', 'done', 'cancelled')),
  remind_crm   boolean not null default true,
  remind_email boolean not null default false,
  remind_sms   boolean not null default false,
  created_at   timestamptz not null default now(),
  created_by   uuid
);

create index if not exists idx_follow_ups_client on follow_ups(client_id);
create index if not exists idx_follow_ups_due on follow_ups(due_date) where status = 'pending';

grant all on table follow_ups to anon, authenticated, service_role;

-- Keep clients.follow_up_date/time = soonest pending follow-up (null if none).
create or replace function sync_client_follow_up() returns trigger as $$
declare cid uuid;
begin
  cid := coalesce(new.client_id, old.client_id);
  update clients c set
    follow_up_date = (select due_date from follow_ups
                      where client_id = cid and status = 'pending'
                      order by due_date asc, due_time asc nulls last limit 1),
    follow_up_time = (select due_time from follow_ups
                      where client_id = cid and status = 'pending'
                      order by due_date asc, due_time asc nulls last limit 1)
  where c.id = cid;
  return null;
end;
$$ language plpgsql;

drop trigger if exists trg_follow_ups_sync on follow_ups;
create trigger trg_follow_ups_sync
  after insert or update or delete on follow_ups
  for each row execute function sync_client_follow_up();

-- Backfill: turn each existing single follow_up_date into a follow_ups row.
insert into follow_ups (client_id, type, purpose, due_date, due_time, status)
select id, 'call', 'Follow-up', follow_up_date, follow_up_time, 'pending'
from clients
where follow_up_date is not null
  and not exists (select 1 from follow_ups f where f.client_id = clients.id);
