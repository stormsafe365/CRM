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
- **Claude Code's own chat history and memory do NOT sync between machines** —
  they're local to whichever laptop/desktop you were on. The durable knowledge
  lives in this file and the repo. When starting Claude Code on another machine,
  say: *"Read CLAUDE.md and continue work on the StormSafe CRM."*

## Recent work & open items (handoff — last updated 2026-06-01)

Everything below is committed on `main`. Built across recent sessions:
- **Quote builder capture** — embedded builder read-only → `quotes` row + branded
  PDF in the `quote-pdfs` bucket. Pricing engine untouched; totals match the
  builder to the dollar. (`QuoteBuilderModal.jsx`, `lib/quoteCapture.js`.)
- **Builder cosmetics** — SAVE QUOTE button restyle (navy + hover text-pulse +
  "SAVED ✓" / palm pop) and a GENERATE CONTRACT fireworks burst. Cosmetic only,
  inside `public/quote-builder.html`; pricing/`saveQuote` logic untouched.
- **Follow-up engine** — activity timeline + composer, `Today` page (`/followups`),
  presets/snooze, cooling-off flag.
- **Active Orders** — `/projects`, ordered clients grouped by stage; client +
  factory check-ins share one timeline.
- **In-app notifications** — nav count badge, tab-title count, desktop bell.
- **Daily follow-up email** — Supabase Edge Function (`supabase/functions/daily-followups/`)
  using Resend. Emails each rep (their `users.email`) only their own due clients.

**Open items / TODO:**
1. **Run `db/migrations/007_cooling_off.sql`** in the Supabase SQL Editor — enables
   the cooling-off toggle (UI hides it until the column exists).
2. **Deploy the email function** — needs a Resend account + API key, function
   secrets, and a daily schedule. Steps in
   `supabase/functions/daily-followups/SETUP.md`. Not deployed yet.
3. **SMS reminders (Twilio)** — deferred (needs Twilio account + A2P 10DLC reg).
4. **Per-machine artifacts to recreate** — `.env.local`, and the offline
   "StormSafe Quote Tool" desktop shortcut + logo `.ico` (laptop-only).
5. **Verify** — a report that a James Woods follow-up wasn't on the Dashboard;
   expected if it's future-dated (Dashboard shows only due-today/overdue; future
   ones appear on the `Today` page when due). Confirm it saved on the client.
