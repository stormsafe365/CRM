// PGlite check of db/migrations/026_web_leads.sql over ALL earlier migrations (001-025; 025 is on branch
// live-updates, so a copy sits next to this file). 51 checks. Needs @electric-sql/pglite@0.2.17 (not a CRM dependency):
//   npm i --no-save @electric-sql/pglite@0.2.17 && node db/checks/026_web_leads.check.mjs . <file holding the web-lead key>
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';

const [crm, keyFile] = process.argv.slice(2);
const KEY = fs.readFileSync(keyFile, 'utf8').trim();
const MIG = path.join(crm, 'db', 'migrations');
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));

const db = new PGlite();
await db.exec(`
create role anon nologin; create role authenticated nologin; create role service_role nologin;
grant usage on schema public to anon, authenticated, service_role;
create schema auth; create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
create schema cron; create function cron.schedule(a text, b text, c text) returns int language sql as $$ select 1 $$;
create schema storage; create table storage.buckets (id text primary key, name text, public boolean);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
create function storage.foldername(name text) returns text[] language sql as $$ select string_to_array(name, '/') $$;
create publication supabase_realtime;
-- Supabase gives anon/authenticated everything on new public tables by default
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`);

const A = '00000000-0000-0000-0000-00000000000a', B = '00000000-0000-0000-0000-00000000000b', L = '00000000-0000-0000-0000-00000000000c';
async function people() { await db.exec(`
insert into auth.users (id, email) values ('${A}', 'a@x.com'), ('${B}', 'b@x.com'), ('${L}', 'l@x.com');
insert into users (id, display_name, email, role, created_at) values
  ('${A}', 'Admin A', 'a@x.com', 'admin', now() - interval '3 days'),
  ('${B}', 'Admin B', 'b@x.com', 'admin', now() - interval '2 days'),
  ('${L}', 'Lauren', 'l@x.com', 'rep', now() - interval '1 days')
on conflict (id) do update set display_name = excluded.display_name, role = excluded.role, created_at = excluded.created_at;
`); }
const files = fs.readdirSync(MIG).filter((f) => /^0\d\d_.*\.sql$/.test(f)).sort();
files.splice(files.indexOf('026_web_leads.sql'), 0, '025_live_updates.sql');
const run = async (f) => {
  const p = f === '025_live_updates.sql' ? path.join(here, f) : path.join(MIG, f);
  let sql = fs.readFileSync(p, 'utf8');
  // ALTER TYPE ... ADD VALUE must commit before the value is used: run those lines on their own
  const addv = sql.match(/^\s*alter type .* add value .*;\s*$/gim) || [];
  for (const l of addv) { await db.exec(l); sql = sql.replace(l, ''); }
  return db.exec(sql);
};
const PRE = files.filter((f) => f !== '026_web_leads.sql');
for (const f of PRE) {
  if (f === '023_rep_access.sql') await people();
  try { await run(f); } catch (e) { console.log('MIGRATION ERROR', f, e.message); process.exit(1); }
}
console.log('migrations 001-025 ran:', PRE.length, 'files');

await db.exec(`
insert into clients (name, email, phone, status, primary_rep) values
  ('Old A', 'olda@x.com', '5610000001', 'new_lead', '${A}'),
  ('B one', 'b1@x.com', '(561) 000-0002', 'quoted', '${B}'),
  ('B two', null, '561.000.0003', 'quoted', '${B}'),
  ('B three', 'b3@x.com', null, 'quoted', '${B}'),
  ('Lauren lead', 'jane@doe.com', null, 'contacted', '${L}'),
  ('Lauren two', 'l2@x.com', '5610000005', 'contacted', '${L}');
insert into clients (name, phone, status, primary_rep, deleted_at) values ('Trashed', '7725550000', 'lost', '${B}', now());
`);

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
const q = async (sql, p = []) => (await db.query(sql, p)).rows;
const asRole = async (role, uid, fn) => {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${uid || ''}', false);`);
  try { return await fn(); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
};
const call = (k, kind, name, email, phone, zip, msg) =>
  asRole('anon', null, async () => (await q(`select submit_web_lead($1,$2,$3,$4,$5,$6,$7) r`, [k, kind, name, email, phone, zip, msg]))[0].r);
const err = async (p) => { try { await p; return 'no error'; } catch (e) { return e.message; } };

// ── run 026 ──
const r026 = await db.exec(fs.readFileSync(path.join(MIG, '026_web_leads.sql'), 'utf8'));
const shown = r026[r026.length - 1].rows;
ok(shown.length === 1 && shown[0]['New website leads go to'] === 'Admin B', 'goes to the admin with most leads: ' + JSON.stringify(shown));
const today = (await q(`select (now() at time zone 'America/New_York')::date::text d`))[0].d;

// ── key + kind ──
ok((await err(call('wrong', 'chat', 'X', 'x@y.com', '', '', ''))) === 'bad_key', 'wrong key refused');
ok((await err(call(null, 'chat', 'X', 'x@y.com', '', '', ''))) === 'bad_key', 'no key refused');
ok((await err(call(KEY + 'x', 'chat', 'X', 'x@y.com', '', '', ''))) === 'bad_key', 'longer key refused');
ok((await err(call(KEY, 'sms', 'X', 'x@y.com', '', '', ''))) === 'bad_kind', 'unknown kind refused');
ok((await q(`select count(*)::int n from web_leads`))[0].n === 0, 'refusals store nothing');

// ── a new person through the chat ──
ok((await call(KEY, 'chat', 'jackie  guthart', 'Jackie.Test@Example.com', '5617192294', '', 'Form Submitted via Chat')) === 'new', 'new person -> new');
let c = (await q(`select * from clients where lower(email) = 'jackie.test@example.com'`));
ok(c.length === 1, 'one lead made');
c = c[0];
ok(c.name === 'jackie guthart' && c.phone === '(561) 719-2294' && c.email === 'jackie.test@example.com', 'name/phone/email cleaned: ' + [c.name, c.phone, c.email]);
ok(c.source === 'website_submission' && c.source_detail === 'Wix chat' && c.status === 'new_lead', 'source + status: ' + [c.source, c.source_detail, c.status]);
ok(c.primary_rep === B && c.secondary_rep == null, 'given to Admin B');
ok(String(c.first_contact_date).length > 0 && (await q(`select first_contact_date::text d from clients where id=$1`, [c.id]))[0].d === today, 'first contact = today (ET)');
let acts = await q(`select body, metadata, created_by from activities where client_id = $1 and type = 'note'`, [c.id]);
ok(acts.length === 1 && /^New lead from the website chat\./.test(acts[0].body) && /Form Submitted via Chat/.test(acts[0].body) && acts[0].created_by == null, 'timeline note: ' + JSON.stringify(acts));
let fu = await q(`select * from follow_ups where client_id = $1`, [c.id]);
ok(fu.length === 1 && fu[0].status === 'pending' && fu[0].assigned_to === B && fu[0].purpose === 'Website lead: call back' && fu[0].remind_email === false && fu[0].remind_sms === false, 'call-back follow-up for B, CRM reminder only');
ok((await q(`select follow_up_date::text d from clients where id=$1`, [c.id]))[0].d === today, "lead's follow-up date = today (sync trigger)");

// ── the same person again within 3 hours: no second lead, one note, one follow-up ──
ok((await call(KEY, 'chat', 'Jackie G', '', '+1 (561) 719-2294', '', 'Do you build 30x40?')) === 'matched', 'same phone -> matched');
ok((await call(KEY, 'chat', '', 'JACKIE.TEST@example.com', '', '', 'still there?')) === 'matched', 'same email -> matched');
ok((await q(`select count(*)::int n from clients where phone = '(561) 719-2294'`))[0].n === 1, 'still one lead');
acts = await q(`select body from activities where client_id = $1 and type = 'note'`, [c.id]);
ok(acts.length === 1 && /30x40/.test(acts[0].body) && /still there\?/.test(acts[0].body), 'messages added to the same note: ' + JSON.stringify(acts));
ok((await q(`select count(*)::int n from follow_ups where client_id = $1`, [c.id]))[0].n === 1, 'no second follow-up while one is open');
ok((await q(`select name from clients where id=$1`, [c.id]))[0].name === 'jackie guthart', 'name not overwritten');
// after 3 hours: a new note
await db.exec(`update activities set created_at = now() - interval '4 hours' where client_id = '${c.id}'`);
await call(KEY, 'chat', 'Jackie', '', '5617192294', '', 'back again');
acts = await q(`select body from activities where client_id = $1 and type = 'note' order by created_at`, [c.id]);
ok(acts.length === 2 && /^Came in again through the website chat\./.test(acts[1].body), 'new note after 3 hours');
// follow-up done -> a new one next time
await db.exec(`update follow_ups set status = 'done' where client_id = '${c.id}'`);
await call(KEY, 'chat', 'Jackie', '', '5617192294', '', 'call me');
ok((await q(`select count(*)::int n from follow_ups where client_id = $1 and status = 'pending'`, [c.id]))[0].n === 1, 'new follow-up once the old one is done');

// ── a rep's existing lead (email only): fill in the phone, follow-up to that rep, status untouched ──
ok((await call(KEY, 'form', 'Jane D', 'jane@doe.com', '772-555-1212', '34953', 'Form: Start Your Project\nBuilding: Garage 30x40')) === 'matched', 'rep lead matched by email');
const jl = (await q(`select * from clients where email = 'jane@doe.com'`))[0];
ok(jl.phone === '(772) 555-1212' && jl.zip === '34953' && jl.status === 'contacted' && jl.primary_rep === L && jl.name === 'Lauren lead', 'missing phone/ZIP filled, rest untouched: ' + [jl.phone, jl.zip, jl.status, jl.name]);
ok((await q(`select assigned_to from follow_ups where client_id = $1`, [jl.id]))[0]?.assigned_to === L, "follow-up goes to the lead's own rep");
const jn = await q(`select body from activities where client_id = $1 and type = 'note'`, [jl.id]);
ok(jn.length === 1 && /^Came in again through the website form\./.test(jn[0].body) && /Building: Garage 30x40/.test(jn[0].body), 'form note: ' + JSON.stringify(jn));
// a phone already there is never replaced
await call(KEY, 'chat', 'B1', 'b1@x.com', '3055559999', '', 'hi');
ok((await q(`select phone from clients where email = 'b1@x.com'`))[0].phone === '(561) 000-0002', "existing phone kept");
ok((await q(`select count(*)::int n from clients where name = 'B1'`))[0].n === 0, 'no new lead for b1');

// ── Trash does not count ──
ok((await call(KEY, 'chat', 'Was Trashed', '', '772-555-0000', '', '')) === 'new', 'a lead only in Trash -> a new lead');

// ── a form lead with ZIP ──
ok((await call(KEY, 'form', 'Form Person', 'form@person.com', '', '33401', 'Form: Start Your Project')) === 'new', 'form -> new');
const fp = (await q(`select * from clients where email = 'form@person.com'`))[0];
ok(fp.zip === '33401' && fp.source_detail === 'Wix form' && fp.phone == null, 'form lead: zip + Wix form');

// ── nothing to call back ──
ok((await call(KEY, 'chat', 'Visitor #8024', '', '12345', '', 'who is your manufacturer?')) === 'no_contact', 'anonymous -> no_contact');
ok((await call(KEY, 'chat', 'X', 'not-an-email', '', '', '')) === 'no_contact', 'bad email only -> no_contact');
ok((await q(`select count(*)::int n from clients where name in ('Visitor #8024', 'X')`))[0].n === 0, 'no lead made');

// ── cleaning ──
await call(KEY, 'chat', '<b>Bob</b> "the" `builder`\u0007', 'bob@b.com', '', '', 'hi <script>x</script>');
const bob = (await q(`select c.name, a.body from clients c join activities a on a.client_id = c.id and a.type = 'note' where c.email = 'bob@b.com'`))[0];
ok(!/[<>"`\u0007]/.test(bob.name) && bob.name === 'b Bob /b the builder', 'name cleaned: ' + JSON.stringify(bob.name));
ok(!/[<>]/.test(bob.body), 'message cleaned: ' + JSON.stringify(bob.body));
await call(KEY, 'chat', 'L'.repeat(500), 'long@x.com', '', '', 'm'.repeat(5000));
const lg = (await q(`select c.name, w.message from clients c join web_leads w on w.client_id = c.id where c.email = 'long@x.com'`))[0];
ok(lg.name.length === 120 && lg.message.length === 2000, 'lengths capped');
await call(KEY, 'chat', '', 'noname@x.com', '', '', '');
ok((await q(`select name from clients where email = 'noname@x.com'`))[0]?.name === 'noname', 'no name -> email name');

// ── who can read what ──
ok((await err(asRole('anon', null, () => q(`select * from web_leads`)))).includes('permission denied'), 'anon cannot read the log');
ok((await err(asRole('anon', null, () => q(`select * from web_lead_settings`)))).includes('permission denied'), 'anon cannot read settings');
ok((await err(asRole('authenticated', B, () => q(`select * from web_lead_settings`)))).includes('permission denied'), 'admin cannot read settings through the app');
ok((await asRole('authenticated', B, () => q(`select count(*)::int n from web_leads`)))[0].n > 5, 'admin reads the log');
ok((await asRole('authenticated', L, () => q(`select count(*)::int n from web_leads`)))[0].n === 0, 'rep reads none of the log');
ok((await err(asRole('authenticated', B, () => q(`insert into web_leads (kind, result) values ('chat','new')`)))).includes('permission denied'), 'nobody writes the log directly');
ok((await err(asRole('anon', null, () => q(`insert into clients (name, primary_rep) values ('x', '${B}')`)))).length > 0, 'anon still cannot make a lead directly');
ok((await asRole('authenticated', L, () => q(`select count(*)::int n from clients where source = 'website_submission'`)))[0].n === 0, "rep doesn't see admin's website leads");

// ── daily cap ──
await db.exec(`insert into web_leads (kind, result) select 'chat', 'no_contact' from generate_series(1, 300)`);
ok((await err(call(KEY, 'chat', 'Cap', 'cap@x.com', '', '', ''))) === 'busy', 'busy after 300 a day');
await db.exec(`delete from web_leads where result = 'no_contact' and name is null`);

// ── re-run keeps the rep ──
await db.exec(`update web_lead_settings set rep_id = '${A}'`);
await db.exec(fs.readFileSync(path.join(MIG, '026_web_leads.sql'), 'utf8'));
ok((await q(`select rep_id from web_lead_settings`))[0].rep_id === A, 're-run keeps whoever gets the leads');
ok((await call(KEY, 'chat', 'After rerun', 'after@x.com', '', '', '')) === 'new', 'still works after a re-run');
ok((await q(`select primary_rep from clients where email = 'after@x.com'`))[0].primary_rep === A, 'new lead to the set rep');

console.log(`026: ${pass} PASS / ${fail} FAIL`);
process.exitCode = fail ? 1 : 0;
