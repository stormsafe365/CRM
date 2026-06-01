# Daily follow-up email — setup

A morning email to each rep listing the clients they should follow up on today.
Runs in Supabase's cloud, so it arrives whether or not the CRM app is open.

## 1. Make a Resend account (free)
1. Sign up at https://resend.com.
2. Create an **API key** (API Keys → Create). Copy it.
3. Sender address:
   - **Quick test:** skip this — the function defaults to `onboarding@resend.dev`,
     which can only email the **Resend account owner's** address. Good enough to
     see it working.
   - **Real use (recommended):** Resend → Domains → add `stormsafesteel.com`,
     add the DNS records it shows, verify. Then your `MAIL_FROM` can be
     `StormSafe CRM <crm@stormsafesteel.com>` and it can email anyone (so both
     reps get theirs).

## 2. Deploy the function
Easiest is the dashboard editor; CLI also works.

**Dashboard:** Supabase → Edge Functions → Deploy a new function →
name it `daily-followups` → paste the contents of `index.ts`.

**CLI (if you prefer):**
```
npm i -g supabase
supabase login
supabase functions deploy daily-followups --project-ref srowcnggomldbznpjxpj
```

## 3. Set the secrets
Edge Functions → `daily-followups` → **Secrets** (or `supabase secrets set …`):
- `RESEND_API_KEY` = the key from step 1
- `MAIL_FROM` = `StormSafe CRM <crm@stormsafesteel.com>` (omit to use the test sender)
- `CRM_URL` = optional; the public URL of the CRM if/when it's deployed, so the
  email links back. Leave unset while you run it locally.

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided automatically.

## 4. Test it once
Edge Functions → `daily-followups` → **Invoke** (or `curl` it). It returns JSON
like `{ "today": "...", "recipients": 1, "sent": [...] }` and you should get the
email. (If no one is due today, it sends nothing — set a client's follow-up to
today first to see it.)

## 5. Schedule it (daily)
**Dashboard (recommended):** the function's **Schedule / Cron** tab → run daily.
`0 12 * * *` UTC ≈ 7–8am Eastern (UTC is fixed; Eastern shifts an hour with DST).

**Or SQL** (needs the `pg_cron` + `pg_net` extensions enabled in Database →
Extensions):
```sql
select cron.schedule(
  'daily-followups-email',
  '0 12 * * *',  -- 12:00 UTC; adjust for the hour you want in Eastern
  $$
  select net.http_post(
    url := 'https://srowcnggomldbznpjxpj.supabase.co/functions/v1/daily-followups',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <YOUR_SERVICE_ROLE_KEY>'
    )
  );
  $$
);
```

## Notes
- Each rep is emailed only the clients where they're the **primary rep**, and
  only when they have at least one due — no empty inboxes.
- "Due" = follow_up_date today or earlier, excluding dead leads and ordered
  clients (same rule as the in-app Today page).
- To add SMS later, the same function can call Twilio — ask and I'll wire it.
