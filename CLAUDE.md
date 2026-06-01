# StormSafe CRM — Project Guide (read me first)

Internal 2-rep CRM for **StormSafe Steel** (West Palm Beach, FL). Tracks clients,
quotes, the sales pipeline, and an embedded quote builder. Used by **Jenna** and
**Joshua** across a laptop and a desktop, kept in sync through this GitHub repo
plus a shared **Supabase** cloud project.

## Stack & how to run
- React 18 + Vite + react-router + `@supabase/supabase-js`. No backend besides Supabase.
- `npm install`, then `npm run dev` → http://localhost:3000.
- Env: `.env.local` (gitignored, created per machine) with:
  - `VITE_SUPABASE_URL` — the Supabase project URL
  - `VITE_SUPABASE_ANON_KEY` — the Supabase **publishable** key (`sb_publishable_…`)
  - Vite only exposes `VITE_`-prefixed vars. Do **not** rename them, and do not use `NEXT_PUBLIC_*`.

## Hard rules (do not violate)
- **Never modify the pricing engine or the quote builder** (`public/quote-builder.html`).
  It already matches the manufacturers' dealer tools (CCI Sensei / CA IdeaRoom) to
  the dollar — correct pricing is priority #1. The CRM only **reads** from it
  (totals, payload, printed PDF); it never re-derives prices.
- **Customer-facing output is StormSafe-branded.** Never put a manufacturer name
  (CA / CCI / Carports Anywhere / Carolina Carports) or the word "Eversafe" on
  anything a customer could see. `quotes.manufacturer` is internal routing only.
- Changes to existing interactive/dynamic UI behavior are **additive only**.

## Data model (Supabase)
- Tables: `users`, `clients`, `quotes`, `activities` + a private `quote-pdfs`
  storage bucket. RLS gives any authenticated user full access (correct for a
  2-rep team).
- Sales funnel — `clients.status` (text): `new_lead → contacted → working →
  working_hot → contract_sent → ordered`, plus `dead`.
- Post-order — `clients.project_stage`: `ordered → engineering → permitting →
  scheduling → installed`, plus `revisions_needed`.
- `activities.type`: manual `note/call/email/meeting` + auto `status_change`,
  `quote_created`, `quote_status_change`, `follow_up_set`, `follow_up_completed`.
  **Changing `clients.follow_up_date` auto-logs a `follow_up_set` activity via a
  DB trigger — never also insert one (duplicates).** Manual inserts need an
  explicit `created_by: user.id`.
- Migrations are in `db/migrations/`. Run new ones in the Supabase SQL Editor —
  the app can't run DDL with the publishable key.

## Key features & files
- **Quote builder**: embedded same-origin at `public/quote-builder.html`, opened
  from `src/components/QuoteBuilderModal.jsx`. Read-only capture → a `quotes` row
  + a branded PDF in the `quote-pdfs` bucket. Helpers in `src/lib/quoteCapture.js`.
- **Follow-up engine** (long 3–6 month cycle): `src/pages/Today.jsx` (route
  `/followups`), `src/components/ActivityTimeline.jsx` + `ActivityComposer.jsx`,
  `FollowUpControls.jsx`, `src/lib/followups.js`, `src/lib/messageTemplates.js`.
  Cooling-off flag needs migration `007_cooling_off.sql`.
- **Active Orders**: `src/pages/ActiveOrders.jsx` (route `/projects`), ordered
  clients grouped by `project_stage`; client + factory check-ins share one
  timeline via `activities.metadata.audience`.
- **In-app notifications**: `src/lib/useDueFollowups.js` + nav badge / tab title /
  desktop bell in `src/components/AppLayout.jsx`.

## Cross-machine workflow
- Code syncs via GitHub (`stormsafe365/CRM`, branch `main`). `git pull` when you
  sit down, `git push` when you finish.
- `.env.local` does **not** sync — create it once per machine (the publishable
  key is safe to reuse; it's meant to ship in the browser).
- Client/quote data lives in Supabase cloud, so it's identical on every machine
  the moment you log in.
