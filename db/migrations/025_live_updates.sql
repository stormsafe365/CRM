-- 025_live_updates.sql
-- Live updates (owner 10/30/26: "i should NOT have to refresh every time to see something saved or
-- added"). The CRM listens for database changes on these tables (the lead page: quotes, notes,
-- follow-ups, activity; the leads list, dashboard, pipeline, calendar, today, active orders, all
-- quotes), but these setup files only ever added design_requests to Supabase's realtime
-- publication (020) - which matches saves not showing until a refresh / app restart.
--
-- Turns live updates on for them. Row security still applies to live updates: each person only
-- receives changes to rows they are allowed to see (a rep: her own leads, 023).
--
-- Run once in the Supabase SQL editor. Safe to re-run.

do $$
declare t text;
begin
  foreach t in array array['clients', 'quotes', 'activities', 'client_notes', 'follow_ups'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;

-- Check (should list activities, client_notes, clients, design_requests, follow_ups, quotes):
select tablename from pg_publication_tables where pubname = 'supabase_realtime' order by tablename;
