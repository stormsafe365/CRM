-- 023_rep_access.sql
-- Sales rep logins (owner 10/18/26: "I need a log in for Lauren ... her portal to only show her leads
-- assigned to her, and her stats ... she doesnt see what joshua & I do").
--
--   * ADMINS (users.role = 'admin': the owner and Joshua) see and do everything, as before.
--   * REPS (users.role = 'rep', the default for a new login) see only the leads where they are the
--     Primary or Secondary rep - and only what hangs off those leads: quotes, notes, follow-ups,
--     activity, deposits, design links / customer designs, and the lead's files.
--   * A rep cannot hand a lead to someone else, cannot delete or restore a lead, and cannot change
--     anyone's role (including their own).
--
-- Also closes three gaps found while mapping this (10/18/26):
--   - follow_ups and client_notes had no row security and were granted to the public (anon) key;
--   - "update your own profile" let any signed-in user set their own role to admin;
--   - lead files (bucket quote-pdfs) were open to every signed-in user, whatever the lead.
--
-- Run once in the Supabase SQL editor; safe to re-run. BEFORE running: make sure every person who
-- should see everything is an admin (the check below stops the script if there is no admin at all):
--   update users set role = 'admin' where lower(email) in ('owner@example.com', 'joshua@example.com');
--   select email, role from users order by role, email;

do $$
begin
  if (select count(*) from users where role = 'admin') < 1 then
    raise exception 'No admin yet. Set the admins first (see the top of this file), then run it again.';
  end if;
end;
$$;

-- ── Who is asking ──────────────────────────────────────────────────────
-- SECURITY DEFINER so the rules below can look at users / clients without looping through their own
-- row security. They only ever answer about the signed-in person (auth.uid()).
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from users where id = auth.uid() and role = 'admin')
$$;

create or replace function public.can_see_client(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select cid is not null and (
    public.is_admin()
    or exists (select 1 from clients c where c.id = cid and (c.primary_rep = auth.uid() or c.secondary_rep = auth.uid()))
  )
$$;

-- a file path in the lead-files bucket starts with the lead's id: "<clientId>/..."
create or replace function public.can_see_lead_file(path text) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when split_part(path, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then public.can_see_client(split_part(path, '/', 1)::uuid)
    else public.is_admin()
  end
$$;

revoke all on function public.is_admin() from public, anon;
revoke all on function public.can_see_client(uuid) from public, anon;
revoke all on function public.can_see_lead_file(text) from public, anon;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.can_see_client(uuid) to authenticated;
grant execute on function public.can_see_lead_file(text) to authenticated;

-- ── users: names for everyone signed in; nobody promotes themselves ────
-- (the guards run as the person signed in - NOT security definer - so current_user tells the app
--  user apart from the SQL editor; they ask is_admin() for the role)
drop policy if exists users_update_own on users;
drop policy if exists users_update_own_name on users;
create policy users_update_own_name on users for update to authenticated
  using (auth.uid() = id) with check (auth.uid() = id);

create or replace function public.guard_user_role() returns trigger
language plpgsql set search_path = public as $$
begin
  -- the SQL editor / server (not a signed-in app user) may set roles; in the app only an admin may
  if new.role is distinct from old.role and current_user in ('authenticated', 'anon') and not public.is_admin() then
    raise exception 'Only an admin can change a role.';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_users_guard_role on users;
create trigger trg_users_guard_role before update on users for each row execute function public.guard_user_role();

-- ── clients (the leads) ────────────────────────────────────────────────
drop policy if exists clients_full_access_authenticated on clients;
drop policy if exists clients_select_by_rep on clients;
drop policy if exists clients_insert_by_rep on clients;
drop policy if exists clients_update_by_rep on clients;
drop policy if exists clients_delete_admin on clients;
create policy clients_select_by_rep on clients for select to authenticated
  using (public.is_admin() or primary_rep = auth.uid() or secondary_rep = auth.uid());
create policy clients_insert_by_rep on clients for insert to authenticated
  with check (public.is_admin() or primary_rep = auth.uid() or secondary_rep = auth.uid());
create policy clients_update_by_rep on clients for update to authenticated
  using (public.is_admin() or primary_rep = auth.uid() or secondary_rep = auth.uid())
  with check (public.is_admin() or primary_rep = auth.uid() or secondary_rep = auth.uid());
create policy clients_delete_admin on clients for delete to authenticated
  using (public.is_admin());

create or replace function public.guard_client_rep_changes() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon') and not public.is_admin() then
    if new.primary_rep is distinct from old.primary_rep or new.secondary_rep is distinct from old.secondary_rep then
      raise exception 'Only an admin can change who a lead is assigned to.';
    end if;
    if new.deleted_at is distinct from old.deleted_at then
      raise exception 'Only an admin can delete or restore a lead.';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_clients_guard_rep on clients;
create trigger trg_clients_guard_rep before update on clients for each row execute function public.guard_client_rep_changes();
create index if not exists idx_clients_secondary_rep on clients (secondary_rep);

-- ── Everything that hangs off a lead: visible / editable with the lead ──
do $$
declare t text;
begin
  foreach t in array array['quotes', 'activities', 'follow_ups', 'client_notes', 'payments'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on %I from anon', t);
    execute format('grant select, insert, update, delete on %I to authenticated', t);
    execute format('drop policy if exists %I on %I', t || '_full_access_authenticated', t);
    execute format('drop policy if exists %I on %I', t || '_by_lead', t);
    execute format('create policy %I on %I for all to authenticated using (public.can_see_client(client_id)) with check (public.can_see_client(client_id))', t || '_by_lead', t);
  end loop;
end;
$$;

-- price history (written by a trigger; read with the quote)
do $$
begin
  if to_regclass('public.quote_price_events') is not null then
    drop policy if exists quote_price_events_select_authenticated on quote_price_events;
    drop policy if exists quote_price_events_select_by_lead on quote_price_events;
    create policy quote_price_events_select_by_lead on quote_price_events for select to authenticated
      using (public.is_admin() or public.can_see_client(client_id));
  end if;
end;
$$;

-- ── Design links and the designs customers send ────────────────────────
-- A rep sees a link that is on one of her leads or that she made herself; a design sent through it
-- the same. Links / designs not tied to her (e.g. the owner's shared links) stay with the admins.
do $$
begin
  if to_regclass('public.design_links') is null then return; end if;
  drop policy if exists design_links_auth on design_links;
  drop policy if exists design_links_select_by_rep on design_links;
  drop policy if exists design_links_insert_by_rep on design_links;
  drop policy if exists design_links_update_by_rep on design_links;
  drop policy if exists design_links_delete_admin on design_links;
  create policy design_links_select_by_rep on design_links for select to authenticated
    using (public.is_admin() or created_by = auth.uid() or public.can_see_client(client_id));
  create policy design_links_insert_by_rep on design_links for insert to authenticated
    with check (public.is_admin() or (created_by = auth.uid() and (client_id is null or public.can_see_client(client_id))));
  create policy design_links_update_by_rep on design_links for update to authenticated
    using (public.is_admin() or created_by = auth.uid() or public.can_see_client(client_id))
    with check (public.is_admin() or client_id is null or public.can_see_client(client_id));
  create policy design_links_delete_admin on design_links for delete to authenticated
    using (public.is_admin());

  drop policy if exists design_requests_auth on design_requests;
  drop policy if exists design_requests_select_by_rep on design_requests;
  drop policy if exists design_requests_update_by_rep on design_requests;
  drop policy if exists design_requests_insert_admin on design_requests;
  drop policy if exists design_requests_delete_admin on design_requests;
  create policy design_requests_select_by_rep on design_requests for select to authenticated
    using (public.is_admin() or public.can_see_client(client_id)
      or exists (select 1 from design_links l where l.token = design_requests.link_token and l.created_by = auth.uid()));
  create policy design_requests_update_by_rep on design_requests for update to authenticated
    using (public.is_admin() or public.can_see_client(client_id)
      or exists (select 1 from design_links l where l.token = design_requests.link_token and l.created_by = auth.uid()))
    with check (public.is_admin() or client_id is null or public.can_see_client(client_id));
  create policy design_requests_insert_admin on design_requests for insert to authenticated
    with check (public.is_admin());
  create policy design_requests_delete_admin on design_requests for delete to authenticated
    using (public.is_admin());
end;
$$;

-- ── Lead files (bucket quote-pdfs: "<clientId>/<category>/<file>") ─────
do $$
begin
  if to_regclass('storage.objects') is null then return; end if;
  drop policy if exists quote_pdfs_authenticated_select on storage.objects;
  drop policy if exists quote_pdfs_authenticated_insert on storage.objects;
  drop policy if exists quote_pdfs_authenticated_update on storage.objects;
  drop policy if exists quote_pdfs_authenticated_delete on storage.objects;
  drop policy if exists quote_pdfs_by_lead_select on storage.objects;
  drop policy if exists quote_pdfs_by_lead_insert on storage.objects;
  drop policy if exists quote_pdfs_by_lead_update on storage.objects;
  drop policy if exists quote_pdfs_by_lead_delete on storage.objects;
  create policy quote_pdfs_by_lead_select on storage.objects for select to authenticated
    using (bucket_id = 'quote-pdfs' and public.can_see_lead_file(name));
  create policy quote_pdfs_by_lead_insert on storage.objects for insert to authenticated
    with check (bucket_id = 'quote-pdfs' and public.can_see_lead_file(name));
  create policy quote_pdfs_by_lead_update on storage.objects for update to authenticated
    using (bucket_id = 'quote-pdfs' and public.can_see_lead_file(name))
    with check (bucket_id = 'quote-pdfs' and public.can_see_lead_file(name));
  create policy quote_pdfs_by_lead_delete on storage.objects for delete to authenticated
    using (bucket_id = 'quote-pdfs' and public.can_see_lead_file(name));
end;
$$;

-- ── "Is this customer already a lead?" across ALL leads ────────────────
-- A rep cannot see other reps' leads, but must still be warned before making a second lead for the
-- same customer. Answers with the matching lead's name and whose lead it is - never its phone, email
-- or anything else. Matching like the app: digits-only phone (a leading 1 dropped), lower-case email.
create or replace function public.lead_already_exists(p_email text, p_phone text, p_exclude uuid default null)
returns table (id uuid, name text, rep_name text, mine boolean)
language sql stable security definer set search_path = public as $$
  with q as (
    select nullif(lower(trim(coalesce(p_email, ''))), '') as em,
           nullif(regexp_replace(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), '^1(\d{10})$', '\1'), '') as ph
  )
  select c.id, c.name, coalesce(u.display_name, split_part(u.email, '@', 1)) as rep_name,
         coalesce(c.primary_rep = auth.uid() or c.secondary_rep = auth.uid() or public.is_admin(), false) as mine
  from clients c cross join q
  left join users u on u.id = c.primary_rep
  where auth.uid() is not null
    and c.deleted_at is null
    and (p_exclude is null or c.id <> p_exclude)
    and ((q.em is not null and lower(trim(coalesce(c.email, ''))) = q.em)
      or (q.ph is not null and regexp_replace(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'), '^1(\d{10})$', '\1') = q.ph))
  limit 10
$$;
revoke all on function public.lead_already_exists(text, text, uuid) from public, anon;
grant execute on function public.lead_already_exists(text, text, uuid) to authenticated;

-- Check (should list the new rules):
--   select tablename, policyname from pg_policies where schemaname in ('public', 'storage') order by 1, 2;
