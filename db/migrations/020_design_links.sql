-- 020_design_links.sql
-- Customer design links (owner 10/16/26). A rep sends a lead a personal link to
-- the no-price 3D design page (https://stormsafe-design.pages.dev/?t=<token>).
-- The customer designs the building and taps "Send to my steel building rep";
-- the design lands on that lead in the CRM (Customer Designs card).
--
-- Security:
--   * Both tables: RLS on, signed-in CRM users only. The public (anon) role
--     cannot read or write either table directly.
--   * The design page never talks to Supabase itself. Its own server function
--     (Cloudflare Pages) calls submit_design() / design_link_status() below.
--   * submit_design() only accepts a design for a link a rep created that is
--     not expired or revoked, checks every field's size and shape (a name can
--     not hold < > " or a backtick; strict email shape; picture <= 900 KB),
--     and allows at most 10 sends per link per day, 30 per link in all and
--     200 a day across all links. Sends are taken one at a time, so the
--     limits cannot be raced by many sends at once.
--   * It never returns anything about the lead (only 'ok' or an error code).
--
-- Run once in the Supabase SQL editor. Safe to re-run.

-- ── Links the reps send ────────────────────────────────────────────────
create table if not exists design_links (
  token       text primary key check (token ~ '^[A-Za-z0-9_-]{20,64}$'),
  client_id   uuid references clients(id) on delete set null,   -- null = not tied to a lead yet
  created_by  uuid references users(id) on delete set null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default (now() + interval '120 days'),
  revoked_at  timestamptz
);
create index if not exists design_links_client on design_links (client_id, created_at desc);

-- ── Designs the customers send ─────────────────────────────────────────
create table if not exists design_requests (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  link_token  text references design_links(token) on delete set null,
  client_id   uuid references clients(id) on delete set null,   -- copied from the link
  name        text not null,
  phone       text,
  email       text,
  zip         text,
  notes       text,
  design      jsonb not null,      -- the page's saved design (no prices)
  spec        text,                -- plain-text spec (W x L x H, walls, doors, lean-tos, colors)
  image       text,                -- data:image/jpeg;base64,... picture of the design
  status      text not null default 'new' check (status in ('new', 'seen', 'dismissed')),
  handled_by  uuid references users(id) on delete set null,
  handled_at  timestamptz
);
create index if not exists design_requests_client on design_requests (client_id, created_at desc);
create index if not exists design_requests_status on design_requests (status, created_at desc);
create index if not exists design_requests_link on design_requests (link_token, created_at desc);
create index if not exists design_requests_created on design_requests (created_at desc);

-- ── Access: signed-in CRM users only ───────────────────────────────────
alter table design_links    enable row level security;
alter table design_requests enable row level security;

drop policy if exists design_links_auth on design_links;
create policy design_links_auth on design_links
  for all to authenticated using (true) with check (true);

drop policy if exists design_requests_auth on design_requests;
create policy design_requests_auth on design_requests
  for all to authenticated using (true) with check (true);

revoke all on table design_links    from anon, public;
revoke all on table design_requests from anon, public;
grant select, insert, update, delete on table design_links    to authenticated;
grant select, insert, update, delete on table design_requests to authenticated;

-- ── Link check for the design page: 'ok' | 'expired' | 'invalid' ─────
create or replace function design_link_status(p_token text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  l design_links%rowtype;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{20,64}$' then
    return 'invalid';
  end if;
  select * into l from design_links where token = p_token;
  if not found or l.revoked_at is not null then
    return 'invalid';
  end if;
  if l.expires_at < now() then
    return 'expired';
  end if;
  return 'ok';
end;
$$;

-- ── The customer's send ────────────────────────────────────────────────
-- Errors (raised as text, read by the design page's server function):
--   link_invalid, link_expired, too_many (10 today on this link), link_full (30 on
--   this link), busy (200 today, all links), bad_name, need_contact, bad_phone,
--   bad_email, too_long, bad_design, bad_image
create or replace function submit_design(
  p_token text,
  p_name  text,
  p_phone text,
  p_email text,
  p_zip   text,
  p_notes text,
  p_design jsonb,
  p_spec  text,
  p_image text
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  l design_links%rowtype;
  n int;
  v_name  text := btrim(regexp_replace(coalesce(p_name, ''),  '[[:cntrl:]]', ' ', 'g'));
  v_phone text := btrim(coalesce(p_phone, ''));
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_zip   text := btrim(coalesce(p_zip, ''));
  v_notes text := btrim(coalesce(p_notes, ''));
  v_req   uuid;
  v_client uuid;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{20,64}$' then
    raise exception 'link_invalid';
  end if;
  select * into l from design_links where token = p_token;
  if not found or l.revoked_at is not null then
    raise exception 'link_invalid';
  end if;
  if l.expires_at < now() then
    raise exception 'link_expired';
  end if;

  -- One send at a time (all links), so the counts below cannot be raced by
  -- many sends at once. Sends are rare; the wait is milliseconds.
  perform pg_advisory_xact_lock(hashtext('stormsafe.submit_design'));
  select count(*) into n from design_requests
   where link_token = p_token and created_at > now() - interval '1 day';
  if n >= 10 then
    raise exception 'too_many';
  end if;
  select count(*) into n from design_requests where link_token = p_token;
  if n >= 30 then
    raise exception 'link_full';
  end if;
  select count(*) into n from design_requests where created_at > now() - interval '1 day';
  if n >= 200 then
    raise exception 'busy';
  end if;

  -- No markup characters in a name: it can become a lead's name, which other
  -- screens and the quote documents print.
  if length(v_name) < 1 or length(v_name) > 120 or v_name ~ '[<>"`]' then
    raise exception 'bad_name';
  end if;
  if v_phone = '' and v_email = '' then
    raise exception 'need_contact';
  end if;
  if v_phone <> '' and (length(v_phone) > 40 or v_phone !~ '^[0-9 ()+.-]+$'
                        or length(regexp_replace(v_phone, '\D', '', 'g')) < 10) then
    raise exception 'bad_phone';
  end if;
  if v_email <> '' and (length(v_email) > 160 or v_email !~ '^[a-z0-9._+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$') then
    raise exception 'bad_email';
  end if;
  if length(v_zip) > 10 or length(v_notes) > 2000 or length(coalesce(p_spec, '')) > 12000 then
    raise exception 'too_long';
  end if;
  if v_zip <> '' and v_zip !~ '^[0-9]{5}$' then
    raise exception 'too_long';
  end if;
  if p_design is null or jsonb_typeof(p_design) <> 'object'
     or coalesce(p_design->>'schema', '') <> 'ss-web-design'
     or octet_length(p_design::text) > 262144 then
    raise exception 'bad_design';
  end if;
  if p_image is not null and (length(p_image) > 900000
     or p_image !~ '^data:image/jpeg;base64,[A-Za-z0-9+/]+={0,2}$') then
    raise exception 'bad_image';
  end if;

  -- A lead moved to Trash (clients.deleted_at, migration 017) does not swallow
  -- the design: it waits under Leads > Customer designs instead. to_jsonb()
  -- reads the column whether or not 017 has been run.
  v_client := l.client_id;
  if v_client is not null and (select to_jsonb(c) ->> 'deleted_at' from clients c where c.id = v_client) is not null then
    v_client := null;
  end if;

  insert into design_requests (link_token, client_id, name, phone, email, zip, notes, design, spec, image)
  values (p_token, v_client, v_name, nullif(v_phone, ''), nullif(v_email, ''), nullif(v_zip, ''),
          nullif(v_notes, ''), p_design, p_spec, p_image)
  returning id into v_req;

  -- The lead's timeline shows it too (system entry, no user).
  if v_client is not null then
    insert into activities (client_id, type, body, metadata, created_by)
    values (v_client, 'note',
            'Customer design received from the design link, sent by "' || v_name || '". See Customer Designs.',
            jsonb_build_object('kind', 'design_request', 'design_request_id', v_req),
            null);
  end if;

  return 'ok';
end;
$$;

revoke all on function design_link_status(text) from public;
revoke all on function submit_design(text, text, text, text, text, text, jsonb, text, text) from public;
grant execute on function design_link_status(text) to anon, authenticated;
grant execute on function submit_design(text, text, text, text, text, text, jsonb, text, text) to anon, authenticated;

-- ── Live updates in the CRM (new designs show up without a refresh) ────
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'design_requests'
  ) then
    alter publication supabase_realtime add table design_requests;
  end if;
end;
$$;

-- Check (should list both tables with rowsecurity = true):
--   select tablename, rowsecurity from pg_tables where tablename in ('design_links', 'design_requests');
