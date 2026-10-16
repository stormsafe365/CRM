-- 022_payments.sql
-- Deposits received (owner 10/16/26, for the Performance page: "Start tracking - add a 'Deposit
-- received' amount + date to the order screen so deposits get counted from now on").
-- Until now a deposit lived only on the printed receipt; this keeps each one: the lead, the amount,
-- the day the money came in, how it was paid. Signed-in CRM users only (like every other CRM table);
-- the public / design page has no access. Run once in the Supabase SQL editor; safe to re-run.
-- (The Performance tab itself is for admins only - users.role = 'admin', set with its own one line.)

create table if not exists payments (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references clients(id) on delete cascade,
  kind        text not null default 'deposit' check (kind in ('deposit', 'payment', 'refund')),
  amount      numeric(12, 2) not null check (amount > 0 and amount < 10000000),
  received_on date not null,
  method      text check (method is null or length(method) <= 40),
  note        text check (note is null or length(note) <= 500),
  created_by  uuid references users(id) default auth.uid(),
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create index if not exists payments_client on payments (client_id);
create index if not exists payments_received on payments (received_on);

alter table payments enable row level security;
revoke all on payments from anon, public;
grant select, insert, update, delete on payments to authenticated;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'payments' and policyname = 'payments_full_access_authenticated') then
    create policy payments_full_access_authenticated on payments for all to authenticated using (true) with check (true);
  end if;
end;
$$;

-- Check (should show the new table):
--   select count(*) from payments;
