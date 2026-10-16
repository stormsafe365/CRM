-- 021_design_links_shared.sql
-- Shared design links (owner 10/16/26): "others will be given the link by some
-- concrete contractors or over fb messanger, so people we do not yet have
-- entered into our system". A SHARED link is passed around to many people:
--   * it is never tied to a lead - every design from it waits on the Customer
--     Designs page (not on a lead) until a rep attaches it or makes a lead;
--   * it has a name (who shares it: "ABC Concrete", "Facebook Messenger"),
--     shown with every design that came from it;
--   * higher limits than a personal link: 50 sends a day per shared link, no
--     lifetime cap (all links together still at most 200 a day).
-- A personal link (kind 'lead', every link made before this) works exactly as
-- before. Needs 020_design_links.sql first. Run once in the Supabase SQL
-- editor; safe to re-run.

alter table design_links add column if not exists kind text not null default 'lead';
alter table design_links add column if not exists label text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'design_links_kind_check') then
    alter table design_links add constraint design_links_kind_check check (kind in ('lead', 'shared'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'design_links_label_check') then
    alter table design_links add constraint design_links_label_check check (label is null or (length(label) between 1 and 80 and label !~ '[<>"`]'));
  end if;
end;
$$;

-- The customer's send: as in 020, plus the shared-link rules.
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
  v_shared boolean;
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
  v_shared := l.kind = 'shared';

  -- One send at a time (all links), so the counts below cannot be raced.
  perform pg_advisory_xact_lock(hashtext('stormsafe.submit_design'));
  select count(*) into n from design_requests
   where link_token = p_token and created_at > now() - interval '1 day';
  if n >= (case when v_shared then 50 else 10 end) then
    raise exception 'too_many';
  end if;
  if not v_shared then
    select count(*) into n from design_requests where link_token = p_token;
    if n >= 30 then
      raise exception 'link_full';
    end if;
  end if;
  select count(*) into n from design_requests where created_at > now() - interval '1 day';
  if n >= 200 then
    raise exception 'busy';
  end if;

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
  if v_notes ~ '[<>]' or coalesce(p_spec, '') ~ '[<>]' then
    raise exception 'bad_notes';
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

  -- A shared link never files a design on a lead by itself; a personal link
  -- files it on its lead unless that lead went to Trash.
  v_client := case when v_shared then null else l.client_id end;
  if v_client is not null and (select to_jsonb(c) ->> 'deleted_at' from clients c where c.id = v_client) is not null then
    v_client := null;
  end if;

  insert into design_requests (link_token, client_id, name, phone, email, zip, notes, design, spec, image)
  values (p_token, v_client, v_name, nullif(v_phone, ''), nullif(v_email, ''), nullif(v_zip, ''),
          nullif(v_notes, ''), p_design, p_spec, p_image)
  returning id into v_req;

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

revoke all on function submit_design(text, text, text, text, text, text, jsonb, text, text) from public;
grant execute on function submit_design(text, text, text, text, text, text, jsonb, text, text) to anon, authenticated;

-- Check (should show the two new columns):
--   select column_name from information_schema.columns where table_name = 'design_links' and column_name in ('kind', 'label');
