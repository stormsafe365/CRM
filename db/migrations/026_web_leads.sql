-- 026_web_leads.sql
-- Website leads go straight into the CRM (owner 11/4/26: "how to get it so leads that come in like
-- this [the Wix chat form] also go into our CRM?" ... "include the start your project form too").
--
-- How it flows:
--   Wix Automations ("Send HTTP request") -> the design server, POST /api/lead?k=<key>
--   (design page project, server/lead.js) -> submit_web_lead() below.
--
-- What submit_web_lead() does with one website lead:
--   * a NEW person (no lead with the same phone digits or email, Trash not counted) becomes a New Lead:
--     source "Website Submission", source detail "Wix chat" / "Wix form", first contact today, given to
--     the login in web_lead_settings.rep_id (set below), with a "call back today" follow-up and the
--     message on the lead's timeline;
--   * a person who is ALREADY a lead gets no second lead: the message goes on that lead's timeline
--     (several messages within 3 hours go in one note), a missing phone / email / ZIP is filled in,
--     and a "call back today" follow-up is added unless one is still open. The lead's status, rep and
--     everything else are left alone;
--   * no usable phone or email (an anonymous chat): nothing is made; it is only counted.
--
-- Security:
--   * Only the server that knows the key can send leads: the key itself is never stored here, only
--     its SHA-256 (the key is in Desktop\StormSafe\KEYS and in the Wix automations' address).
--   * Both tables: RLS on. web_lead_settings is not readable through the app at all; web_leads (the
--     log of what came in) is readable by admins only.
--   * Names lose < > " ` and control characters (a name is printed on quotes and contracts), messages
--     lose < and >, everything is length-capped, and at most 300 website leads are taken a day.
--
-- Run once in the Supabase SQL editor. Safe to re-run (a re-run keeps whoever gets the new leads).

-- ── Settings: the key's fingerprint and who gets new website leads ─────
create table if not exists web_lead_settings (
  id         int primary key default 1 check (id = 1),
  key_hash   text not null check (key_hash ~ '^[0-9a-f]{64}$'),
  rep_id     uuid not null references users(id),
  updated_at timestamptz not null default now()
);

-- ── What came in (a log; the leads themselves are ordinary leads) ──────
create table if not exists web_leads (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  kind       text not null check (kind in ('chat', 'form')),
  name       text,
  email      text,
  phone      text,
  zip        text,
  message    text,
  client_id  uuid references clients(id) on delete set null,
  result     text not null check (result in ('new', 'matched', 'no_contact'))
);
create index if not exists web_leads_created on web_leads (created_at desc);
create index if not exists web_leads_client on web_leads (client_id, created_at desc);

alter table web_lead_settings enable row level security;
alter table web_leads         enable row level security;
revoke all on table web_lead_settings from anon, authenticated, public;
revoke all on table web_leads         from anon, authenticated, public;
grant select on table web_leads to authenticated;
drop policy if exists web_leads_admin_read on web_leads;
create policy web_leads_admin_read on web_leads for select to authenticated using (public.is_admin());

-- New website leads go to the admin login that holds the most leads (the one the office works from);
-- a re-run keeps whoever is set. To change it later:
--   update web_lead_settings set rep_id = (select id from users where email = '<login email>');
do $$
declare
  v_rep uuid;
begin
  select u.id into v_rep
    from users u
    left join clients c on c.primary_rep = u.id and c.deleted_at is null
   where u.role = 'admin'
   group by u.id, u.created_at
   order by count(c.id) desc, u.created_at
   limit 1;
  if v_rep is null then
    raise exception 'No admin login found. Set the admins first (see 023_rep_access.sql), then run this again.';
  end if;
  insert into web_lead_settings (id, key_hash, rep_id)
  values (1, '06e852c852a083e271012ac2f82b9a8cfe0b53ef2df66fb06c4fe49cf8ef7fa2', v_rep)
  on conflict (id) do update set key_hash = excluded.key_hash, updated_at = now();
end;
$$;

-- ── One website lead ───────────────────────────────────────────────────
-- Returns 'new' | 'matched' | 'no_contact'. Errors (raised as text, read by the server):
--   bad_key, bad_kind, busy (300 today)
drop function if exists submit_web_lead(text, text, text, text, text, text, text);
create or replace function submit_web_lead(
  p_key     text,
  p_kind    text,
  p_name    text,
  p_email   text,
  p_phone   text,
  p_zip     text,
  p_message text
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s         web_lead_settings%rowtype;
  n         int;
  v_kind    text := lower(btrim(coalesce(p_kind, '')));
  v_name    text;
  v_email   text := lower(btrim(coalesce(p_email, '')));
  v_digits  text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_phone   text := '';
  v_zip     text := btrim(coalesce(p_zip, ''));
  v_msg     text;
  v_where   text;
  v_now     text := to_char(now() at time zone 'America/New_York', 'Mon FMDD, FMHH12:MI AM');
  v_today   date := (now() at time zone 'America/New_York')::date;
  v_client  uuid;
  v_rep     uuid;
  v_result  text;
  v_log     uuid;
  v_act     uuid;
  v_body    text;
begin
  select * into s from web_lead_settings where id = 1;
  if not found or p_key is null or length(p_key) > 200
     or encode(sha256(convert_to(p_key, 'UTF8')), 'hex') <> s.key_hash then
    raise exception 'bad_key';
  end if;
  if v_kind not in ('chat', 'form') then
    raise exception 'bad_kind';
  end if;

  -- One at a time, so the daily cap cannot be raced.
  perform pg_advisory_xact_lock(hashtext('stormsafe.submit_web_lead'));
  select count(*) into n from web_leads where created_at > now() - interval '1 day';
  if n >= 300 then
    raise exception 'busy';
  end if;

  -- Clean what came in.
  v_name := left(btrim(regexp_replace(regexp_replace(coalesce(p_name, ''), '[[:cntrl:]<>"`]', ' ', 'g'), '\s+', ' ', 'g')), 120);
  if length(v_email) > 160 or v_email !~ '^[a-z0-9._+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$' then
    v_email := '';
  end if;
  if length(v_digits) = 11 and left(v_digits, 1) = '1' then
    v_digits := substr(v_digits, 2);
  end if;
  if length(v_digits) = 10 then
    v_phone := '(' || substr(v_digits, 1, 3) || ') ' || substr(v_digits, 4, 3) || '-' || substr(v_digits, 7, 4);
  else
    v_digits := '';
  end if;
  if v_zip !~ '^[0-9]{5}$' then
    v_zip := '';
  end if;
  v_msg := left(btrim(regexp_replace(regexp_replace(coalesce(p_message, ''), '[<>]', ' ', 'g'),
                                     '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]', ' ', 'g')), 2000);
  if v_name = '' then
    v_name := coalesce(nullif(split_part(v_email, '@', 1), ''), 'Website visitor');
  end if;
  v_where := case v_kind when 'chat' then 'the website chat' else 'the website form' end;

  -- Nobody to call back (an anonymous chat): count it, make nothing.
  if v_email = '' and v_digits = '' then
    insert into web_leads (kind, name, message, result) values (v_kind, v_name, nullif(v_msg, ''), 'no_contact');
    return 'no_contact';
  end if;

  -- Already a lead? Same matching as the app's "already a lead" check: digits-only phone (a leading 1
  -- dropped) or lower-case email. Leads in Trash do not count.
  select c.id, c.primary_rep into v_client, v_rep
    from clients c
   where c.deleted_at is null
     and ((v_digits <> '' and regexp_replace(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'), '^1(\d{10})$', '\1') = v_digits)
       or (v_email <> '' and lower(btrim(coalesce(c.email, ''))) = v_email))
   order by c.updated_at desc nulls last
   limit 1;

  if v_client is null then
    insert into clients (name, email, phone, zip, source, source_detail, status, primary_rep, first_contact_date)
    values (v_name, nullif(v_email, ''), nullif(v_phone, ''), nullif(v_zip, ''), 'website_submission',
            case v_kind when 'chat' then 'Wix chat' else 'Wix form' end, 'new_lead', s.rep_id, v_today)
    returning id into v_client;
    v_rep := s.rep_id;
    v_result := 'new';
  else
    -- fill in only what the lead is missing; nothing typed by a rep is changed
    update clients set
      email = coalesce(nullif(btrim(coalesce(email, '')), ''), nullif(v_email, '')),
      phone = coalesce(nullif(btrim(coalesce(phone, '')), ''), nullif(v_phone, '')),
      zip   = coalesce(nullif(btrim(coalesce(zip, '')), ''), nullif(v_zip, ''))
     where id = v_client
       and ((coalesce(btrim(email), '') = '' and v_email <> '')
         or (coalesce(btrim(phone), '') = '' and v_phone <> '')
         or (coalesce(btrim(zip), '') = '' and v_zip <> ''));
    v_result := 'matched';
  end if;

  insert into web_leads (kind, name, email, phone, zip, message, client_id, result)
  values (v_kind, v_name, nullif(v_email, ''), nullif(v_phone, ''), nullif(v_zip, ''), nullif(v_msg, ''), v_client, v_result)
  returning id into v_log;

  -- The lead's timeline: messages from the same place within 3 hours go in one note.
  select a.id into v_act
    from activities a
   where a.client_id = v_client
     and a.type = 'note'
     and a.metadata ->> 'kind' = 'web_lead'
     and a.metadata ->> 'source' = v_kind
     and a.created_at > now() - interval '3 hours'
   order by a.created_at desc
   limit 1;
  if v_act is not null then
    update activities
       set body = left(body || E'\n' || v_now || ': ' || coalesce(nullif(v_msg, ''), '(no message)'), 6000)
     where id = v_act;
  else
    v_body := case v_result
                when 'new' then 'New lead from ' || v_where || '.'
                else 'Came in again through ' || v_where || '.'
              end
              || case when v_email <> '' then E'\nEmail: ' || v_email else '' end
              || case when v_phone <> '' then E'\nPhone: ' || v_phone else '' end
              || case when v_zip <> '' then E'\nZIP: ' || v_zip else '' end
              || E'\n' || v_now || ': ' || coalesce(nullif(v_msg, ''), '(no message)');
    insert into activities (client_id, type, body, metadata, created_by)
    values (v_client, 'note', left(v_body, 6000),
            jsonb_build_object('kind', 'web_lead', 'source', v_kind, 'web_lead_id', v_log), null);
  end if;

  -- A call-back for today, unless one from the website is still open on this lead.
  if not exists (select 1 from follow_ups f
                  where f.client_id = v_client and f.status = 'pending' and f.purpose = 'Website lead: call back') then
    insert into follow_ups (client_id, audience, type, purpose, details, assigned_to, due_date, status, created_by)
    values (v_client, 'client', 'call', 'Website lead: call back',
            left('Came in through ' || v_where || case when v_msg <> '' then ': ' || v_msg else '.' end, 1000),
            coalesce(v_rep, s.rep_id), v_today, 'pending', null);
  end if;

  return v_result;
end;
$$;

revoke all on function submit_web_lead(text, text, text, text, text, text, text) from public;
grant execute on function submit_web_lead(text, text, text, text, text, text, text) to anon, authenticated;

-- Who gets the new website leads (this is what the SQL editor shows after the run):
select coalesce(nullif(u.display_name, ''), u.email) as "New website leads go to", u.email as "login"
  from web_lead_settings s join users u on u.id = s.rep_id;
