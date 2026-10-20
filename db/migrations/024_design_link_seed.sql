-- 024_design_link_seed.sql
-- A design link can start the customer ON THEIR OWN BUILDING (owner 10/20/26: "start sending them a link with
-- their 3D building design (no pricing listed) but a way for them to make edits ... then they can click send to
-- StormSafe Rep ... and I'd get the adjustment from them & rework their quote").
--
-- The rep makes the link from a lead's saved quote; the building (size, walls, doors, windows, lean-tos, colors,
-- upgrades - NEVER a price, a name, a phone or an email) is stored on the link as `seed`. The design page asks for
-- it with the link (design_link_seed below, through its own server function, the same way it checks the link),
-- opens on that building, and the customer edits it and sends it back like any design. The CRM compares what
-- comes back with the seed and lists what changed.
--
-- Security (same model as 020):
--   * design_links stays signed-in-only (RLS); the public role cannot read it.
--   * design_link_seed() is SECURITY DEFINER and returns the seed only for a live link (exists, not revoked, not
--     expired); anything else returns null - it never says which. It returns nothing but the seed.
--   * The seed must be an 'ss-web-design' object of at most 64 KB (the page's own saved-design envelope).
-- Needs 020 first (021 is not required). Run once in the Supabase SQL editor; safe to re-run.

alter table design_links add column if not exists seed jsonb;
-- Rep-side only (never returned to the page): which quote the building came from, and what could not be carried over.
alter table design_links add column if not exists seed_quote_id uuid references quotes(id) on delete set null;
alter table design_links add column if not exists seed_quote_number text;
alter table design_links add column if not exists seed_notes jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'design_links_seed_check') then
    alter table design_links add constraint design_links_seed_check
      check (seed is null or (jsonb_typeof(seed) = 'object' and seed ->> 'schema' = 'ss-web-design' and octet_length(seed::text) <= 65536));
  end if;
end;
$$;

create or replace function design_link_seed(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  l design_links%rowtype;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{20,64}$' then
    return null;
  end if;
  select * into l from design_links where token = p_token;
  if not found or l.revoked_at is not null or l.expires_at < now() then
    return null;
  end if;
  return l.seed;
end;
$$;

revoke all on function design_link_seed(text) from public;
grant execute on function design_link_seed(text) to anon, authenticated;

-- Check (should show 'seed' and one row of the function):
--   select column_name from information_schema.columns where table_name = 'design_links' and column_name in ('seed','seed_quote_id','seed_quote_number','seed_notes');
--   select proname from pg_proc where proname = 'design_link_seed';
