-- =====================================================================
-- StormSafe CRM — SAMPLE DATA (safe to delete)
-- ---------------------------------------------------------------------
-- Purpose: populate the dashboard, charts, and pipeline so you can see
--          the design fully alive before real data is in.
-- How to run: Supabase dashboard → SQL Editor → New query → paste this
--          whole file → Run. (Runs as admin, so RLS won't block it.)
-- Rows are tagged notes = 'SAMPLE — safe to delete'.
-- To remove everything later, run the DELETE block at the very bottom.
-- =====================================================================

-- 6 sample Florida clients across pipeline stages. primary_rep is bound
-- to your first user account automatically.
with rep as (select id from public.users order by created_at limit 1)
insert into clients
  (name, email, phone, city, county, state, source, status, project_stage, primary_rep,
   follow_up_date, first_contact_date, building_size, building_type, notes)
select v.name, v.email, v.phone, v.city, v.county, 'FL',
       v.source::lead_source, v.status::client_status, v.pstage, (select id from rep),
       v.fu, v.fc, v.size, v.btype, 'SAMPLE — safe to delete'
from (values
  ('Marcus Delgado',  'mdelgado@example.com',  '(561) 555-0142', 'Wellington',    'Palm Beach', 'google_search',     'quoted',        null,           current_date,      current_date - 6,  '30x50x14', 'commercial'),
  ('Rivera Family',   'jrivera@example.com',   '(772) 555-0188', 'Stuart',        'Martin',     'referral_customer', 'follow_up',     null,           current_date - 2,  current_date - 11, '24x40x12', 'residential'),
  ('Janet Okafor',    'jokafor@example.com',   '(954) 555-0166', 'Coral Springs', 'Broward',    'facebook',          'quoted',        null,           current_date + 1,  current_date - 9,  '20x30x10', 'residential'),
  ('Coastal Storage', 'ops@coastalstor.example','(772) 555-0210','Fort Pierce',   'St. Lucie',  'google_search',     'contract_sent', null,           current_date,      current_date - 14, '40x60x16', 'commercial'),
  ('Tom Brennan',     'tbrennan@example.com',  '(239) 555-0119', 'Fort Myers',    'Lee',        'instagram',         'new_lead',      null,           current_date + 3,  current_date - 1,  '30x40x12', 'residential'),
  ('Sandhill Stables','barn@sandhill.example', '(352) 555-0131', 'Ocala',         'Marion',     'event',             'ordered',       'engineering',  current_date - 1,  current_date - 20, '36x48x12', 'agricultural')
) as v(name, email, phone, city, county, source, status, pstage, fu, fc, size, btype);

-- 8 sample quotes (mix of manufacturers, statuses, and dates) so the
-- area chart, donut, win-rate gauge, and money KPIs all have something
-- to show. created_at is spread across the last month for the trend.
with rep as (select id from public.users order by created_at limit 1)
insert into quotes
  (client_id, quote_number, manufacturer, building_summary, building_size,
   total_amount, deposit_amount, balance_amount, status, quote_date,
   created_by, created_at, notes)
select c.id, v.qnum, v.mfr::manufacturer_type, v.summary, v.size,
       v.total, v.dep, v.total - v.dep, v.status::quote_status, v.qdate,
       (select id from rep), v.cat, 'SAMPLE — safe to delete'
from (values
  ('Marcus Delgado',  'SS-2026-80001', 'cci', '30x50x14 workshop',  '30x50x14', 42800,     0, 'sent',          current_date - 5,  now() - interval '5 days'),
  ('Rivera Family',   'SS-2026-80002', 'ca',  '24x40x12 garage',    '24x40x12', 18900,     0, 'verbal_accept', current_date - 9,  now() - interval '9 days'),
  ('Janet Okafor',    'SS-2026-80003', 'ca',  '20x30x10 carport',   '20x30x10',  9200,     0, 'sent',          current_date - 2,  now() - interval '2 days'),
  ('Coastal Storage', 'SS-2026-80004', 'cci', '40x60x16 storage',   '40x60x16', 71400,     0, 'sent',          current_date - 6,  now() - interval '6 days'),
  ('Tom Brennan',     'SS-2026-80005', 'cci', '30x40x12 RV cover',  '30x40x12', 14600,     0, 'draft',         current_date - 1,  now() - interval '1 day'),
  ('Sandhill Stables','SS-2026-80006', 'ca',  '36x48x12 hay barn',  '36x48x12', 62300, 15575, 'deposit_paid',  current_date - 12, now() - interval '12 days'),
  ('Marcus Delgado',  'SS-2026-80007', 'cci', '30x50x14 (v1)',      '30x50x14', 41200,     0, 'superseded',    current_date - 20, now() - interval '22 days'),
  ('Janet Okafor',    'SS-2026-80008', 'ca',  '20x30x10 (v1)',      '20x30x10',  8400,     0, 'declined',      current_date - 26, now() - interval '30 days')
) as v(cust, qnum, mfr, summary, size, total, dep, status, qdate, cat)
join clients c on c.name = v.cust and c.notes = 'SAMPLE — safe to delete';


-- =====================================================================
-- CLEANUP — run ONLY this block later to remove all sample data.
-- (Deleting the clients cascades to their quotes automatically.)
-- =====================================================================
-- delete from clients where notes = 'SAMPLE — safe to delete';
