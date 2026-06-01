// daily-followups — Supabase Edge Function.
// Each morning, email every rep the clients they should follow up on today
// (due today or overdue, pre-order, non-dead). Sent via Resend. Runs in
// Supabase's cloud on a schedule, so it reaches you whether or not the app is
// open. CRM workflow only — no pricing, no manufacturer names.
//
// Secrets to set (Dashboard → Edge Functions → daily-followups → Secrets):
//   RESEND_API_KEY  — from resend.com
//   MAIL_FROM       — a verified Resend sender, e.g. "StormSafe CRM <crm@yourdomain.com>"
//                     (defaults to Resend's test sender, which can only email the
//                      Resend account owner until you verify a domain)
//   CRM_URL         — optional; if set, emails link back to the app
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const DEAD = ['dead', 'lost', 'cancelled']

// Florida "today" (America/New_York) as YYYY-MM-DD — avoids a UTC off-by-one
// near midnight, matching how the app computes the due list.
function isoToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

function esc(s: string) {
  return String(s).replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]!))
}

function json(o: unknown, status = 200) {
  return new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } })
}

function renderEmail(name: string, items: any[], today: string, crmUrl: string) {
  const rows = items.map(c => {
    const overdue = c.follow_up_date < today
    const when = overdue ? `due since ${c.follow_up_date}` : 'due today'
    const link = crmUrl ? `${crmUrl}/clients/${c.id}` : ''
    const nameCell = link
      ? `<a href="${link}" style="color:#00d9d9;text-decoration:none;font-weight:600">${esc(c.name)}</a>`
      : `<span style="color:#e9f1f8;font-weight:600">${esc(c.name)}</span>`
    return `<tr><td style="padding:9px 0;border-bottom:1px solid #1d2735">${nameCell}
      <span style="color:#5f6f82;font-size:13px"> — ${when}</span></td></tr>`
  }).join('')
  const cta = crmUrl
    ? `<p style="margin-top:22px"><a href="${crmUrl}/followups" style="background:#00d9d9;color:#04181a;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:700">Open Today in the CRM</a></p>`
    : ''
  return `<div style="font-family:Arial,Helvetica,sans-serif;background:#080b11;color:#e9f1f8;padding:24px;max-width:560px">
    <h2 style="margin:0 0 4px;font-size:20px">Good morning, ${esc(name)} 🌴</h2>
    <p style="color:#9fb0c3;margin:0 0 18px">A few people to gently check in with today — no rush, just keeping the thread warm.</p>
    <table style="width:100%;border-collapse:collapse">${rows}</table>
    ${cta}
    <p style="color:#5f6f82;font-size:12px;margin-top:26px">StormSafe Steel CRM · daily follow-up summary</p>
  </div>`
}

async function sendEmail(apiKey: string, from: string, to: string, subject: string, html: string) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, subject, html }),
  })
  return { ok: res.ok, status: res.status, body: await res.text() }
}

Deno.serve(async () => {
  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const resendKey = Deno.env.get('RESEND_API_KEY')
    const from = Deno.env.get('MAIL_FROM') || 'StormSafe CRM <onboarding@resend.dev>'
    const crmUrl = (Deno.env.get('CRM_URL') || '').replace(/\/$/, '')
    if (!resendKey) return json({ error: 'RESEND_API_KEY is not set' }, 500)

    const sb = createClient(url, serviceKey)
    const today = isoToday()

    const { data: users, error: uErr } = await sb.from('users').select('id, email, display_name')
    if (uErr) throw uErr

    const { data: clients, error: cErr } = await sb
      .from('clients')
      .select('id, name, follow_up_date, status, primary_rep')
      .not('follow_up_date', 'is', null)
      .lte('follow_up_date', today)
    if (cErr) throw cErr

    const due = (clients ?? []).filter(c => !DEAD.includes(c.status) && c.status !== 'ordered')

    const sent: any[] = []
    for (const u of users ?? []) {
      if (!u.email) continue
      const mine = due
        .filter(c => c.primary_rep === u.id)
        .sort((a, b) => a.follow_up_date.localeCompare(b.follow_up_date))
      if (mine.length === 0) continue // never send an empty "nothing to do" email
      const subject = `${mine.length} follow-up${mine.length === 1 ? '' : 's'} for today`
      const html = renderEmail(u.display_name || 'there', mine, today, crmUrl)
      const r = await sendEmail(resendKey, from, u.email, subject, html)
      sent.push({ to: u.email, count: mine.length, ok: r.ok, status: r.status })
    }

    return json({ today, recipients: sent.length, sent })
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500)
  }
})
