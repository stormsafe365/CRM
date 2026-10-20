// DesignLinkModal: "Send design link" (owner 10/16/26). Makes the lead's personal
// link to the no-price 3D design page and helps the rep send it: copy the link,
// copy the message, open a RingCentral text, or an email. The rep sends it —
// nothing goes to the customer automatically. When the customer taps "Send to
// my steel building rep", the design shows on the lead (Customer Designs).
//
// Opened from the lead page (client known) or from the quote program's SEND
// DESIGN LINK button. Without a lead (3D Builder tab / New Quote) it asks which
// lead first; "No lead yet" makes a link whose design shows under Leads ›
// Customer designs, where it can be attached to a lead.

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useUsers } from '../lib/useUsers'
import { useLeadSearch } from '../lib/useLeadSearch'
import { toast } from '../lib/uiFx'
import { createDesignLink, designLinkMessage, logDesignLink, sharedLinkMessage, sharedLabelOk, SHARED_LINK_DAYS, seededLinkMessage, loadLeadQuotesForPicker, quotePickerReason, designSummary } from '../lib/designLinks'
import { quoteToSeed } from '../lib/designSeed'
import { readQuoteForLayout } from '../lib/quoteLayoutEngine'
import { sortStarredFirst } from '../lib/layoutFromQuote'
import { currentOrderQuote } from '../lib/contractDocs'
import { quoteStatusLabel } from '../lib/constants'

const FIELD = {
  width: '100%', boxSizing: 'border-box', background: 'var(--inset, #0B1B32)', color: 'var(--fg, #e2e8f0)',
  border: '1px solid var(--line, #294059)', borderRadius: 8, padding: '9px 11px', fontSize: 13.5, fontFamily: 'inherit',
}
const LBL = { display: 'block', fontSize: 11.5, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--fg-3, #8598AC)', margin: '12px 0 5px' }
const MUTED = { color: 'var(--fg-3, #8598AC)', fontSize: 12.5, lineHeight: 1.45 }

function rcTextHref(phone) {
  let d = String(phone || '').replace(/\D/g, '')
  if (d.length === 10) d = '1' + d
  return 'rcapp://r/sms?type=new&number=' + encodeURIComponent('+' + d)
}

async function copyText(text, what) {
  try {
    await navigator.clipboard.writeText(text)
    toast(`${what} copied`, 'success')
    return true
  } catch {
    window.prompt(`Copy the ${what.toLowerCase()}:`, text)
    return false
  }
}

const quoteDate = (q) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(q.quote_date || q.created_at || '')
  return m ? `${m[2]}/${m[3]}/${m[1]}` : ''
}
// "30x40x12" (W x L x H as saved) -> "30′ × 40′ × 12′"
const quoteSize = (q) => {
  const p = String(q.building_size || '').split(/x/i).map((x) => x.trim()).filter(Boolean)
  return p.length >= 2 ? p.map((x) => `${x}′`).join(' × ') : ''
}
const quoteRowText = (q) => [q.quote_number ? `#${q.quote_number}` : '(no number)', quoteDate(q), quoteSize(q), quoteStatusLabel(q.status)].filter(Boolean).join(' · ') + (q.starred ? ' ★' : '')
const HARD_WAIT_MS = 25000

// shared: open straight on the shared-link step (contractor / Facebook - many people; owner 10/16/26).
// onMade(link) is told when a link was made.
// quote: the saved quote the rep has open (the builder's SEND DESIGN LINK) - preselected in the quote step.
export default function DesignLinkModal({ client = null, onClose, zIndex = 1300, shared: startShared = false, onMade, quote = null }) {
  const { user } = useAuth()
  const { users } = useUsers()
  const [lead, setLead] = useState(client)          // the lead the link is for (null = pick / none)
  const [picking, setPicking] = useState(!client && !startShared)
  const [sharedMode, setSharedMode] = useState(!client && startShared) // a shared link (many people)
  const [label, setLabel] = useState('')
  const [search, setSearch] = useState('')
  const [link, setLink] = useState(null)            // { token, url }
  const [msg, setMsg] = useState('')
  const [msgEdited, setMsgEdited] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const madeRef = useRef(false)
  // the "which building" step (owner 10/20/26): a lead's link can open on the building of one of their saved quotes
  const [quotes, setQuotes] = useState([])           // the lead's quotes (light rows)
  const [step, setStep] = useState('')               // '' | 'quote' | 'preparing' | 'review'
  const [pick, setPick] = useState('')               // quote id | 'blank'
  const [pickErr, setPickErr] = useState('')
  const [progress, setProgress] = useState('')
  const [pack, setPack] = useState(null)             // { seed, notes, quote, positions } once the building is read
  const { leads, list: shown, err: leadsErr } = useLeadSearch(picking, search)

  // The customer reads this: the rep's DISPLAY name only (never an email or
  // "Unknown rep"); without one the message just says StormSafe Steel.
  const repFirst = users.find((u) => u.id === user?.id)?.display_name || ''

  // The message follows the lead / rep name (the user list may load after the
  // link) until the rep edits it.
  useEffect(() => {
    if (link && !msgEdited) {
      setMsg(sharedMode ? sharedLinkMessage({ url: link.url })
        : pack ? seededLinkMessage({ clientName: lead?.name, repName: repFirst, url: link.url })
          : designLinkMessage({ clientName: lead?.name, repName: repFirst, url: link.url }))
    }
  }, [link, lead, repFirst, msgEdited, sharedMode, pack])

  // pk = { seed, notes, quote }: the link opens on that quote's building. A seeded link is never quietly made
  // plain: if the database can't hold the seed the error stays on screen (and the rep can go back).
  async function make(forLead, sharedLabel, pk = null) {
    if (madeRef.current) return
    madeRef.current = true
    setBusy(true); setErr('')
    try {
      const l = sharedLabel
        ? await createDesignLink(supabase, { userId: user?.id ?? null, kind: 'shared', label: sharedLabel })
        : await createDesignLink(supabase, {
          clientId: forLead?.id ?? null, userId: user?.id ?? null,
          ...(pk ? { seed: pk.seed, seedQuoteId: pk.quote.id, seedQuoteNumber: pk.quote.quote_number, seedNotes: pk.notes } : {}),
        })
      setLink(l)
      setStep('')
      try { onMade?.(l) } catch { /* the caller's refresh is best-effort */ }
      try { await logDesignLink(supabase, { clientId: forLead?.id, userId: user?.id, url: l.url, quoteId: pk?.quote.id ?? null, quoteNumber: pk?.quote.quote_number ?? null }) } catch { /* timeline entry is best-effort */ }
    } catch (e) {
      madeRef.current = false
      setErr(e.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  // A lead is known: if they have a usable quote, ask which building the link opens on (nothing is made yet);
  // otherwise make the plain link right away, exactly as before.
  async function startQuoteStep(forLead) {
    setBusy(true); setErr('')
    let rows = []
    try { rows = (await loadLeadQuotesForPicker(supabase, forLead.id)).rows } catch { rows = [] }
    const sorted = sortStarredFirst(rows)
    const enabled = sorted.filter((q) => !quotePickerReason(q))
    setBusy(false)
    if (!enabled.length) { make(forLead); return }
    const live = enabled.filter((q) => q.status !== 'superseded')
    const inHand = quote?.id ? enabled.find((q) => q.id === quote.id) : null
    const dflt = inHand || currentOrderQuote(enabled) || live[0] || enabled[0]
    setQuotes(sorted)
    setPick(dflt ? dflt.id : 'blank')
    setStep('quote')
  }
  useEffect(() => {
    if (client?.id) startQuoteStep(client)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function choose(c) {
    setLead(c); setPicking(false)
    startQuoteStep(c)
  }

  // The rep confirmed a quote: read its saved building, ask the quote program (hidden, nothing saved) where every
  // door and window really sits, build the seed. The program is slow or unavailable -> typed positions + a note.
  async function confirmQuote() {
    if (pick === 'blank') { setPack(null); make(lead); return }
    const q = quotes.find((x) => x.id === pick)
    if (!q) return
    setPickErr(''); setStep('preparing'); setBusy(true); setProgress('Reading the saved quote…')
    try {
      const { data, error } = await supabase.from('quotes').select('payload_json').eq('id', q.id).maybeSingle()
      const row = Array.isArray(data) ? data[0] : data
      const payload = row?.payload_json
      if (error || !payload) throw new Error('Could not read that quote. Try again, or pick another.')
      const pre = quoteToSeed(payload, { quote: q })
      if (!pre.ok) { setPickErr(pre.reason); setStep('quote'); return }
      setProgress('Preparing their building…')
      let layout = null
      try {
        layout = await Promise.race([readQuoteForLayout(payload, { timeoutMs: 20000 }), new Promise((_, rej) => setTimeout(() => rej(new Error('slow')), HARD_WAIT_MS))])
      } catch { layout = null }
      const res = quoteToSeed(payload, { layout, quote: q })
      if (!res.ok) { setPickErr(res.reason); setStep('quote'); return }
      setPack({ seed: res.seed, notes: res.notes, quote: q, positions: res.positions })
      setStep('review')
    } catch (e) {
      setPickErr(e.message || 'Could not read that quote.')
      setStep('quote')
    } finally {
      setBusy(false)
    }
  }

  const head = (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
      <div>
        <div style={{ fontSize: 16, fontWeight: 800 }}>{sharedMode ? 'Shared design link' : 'Send design link'}</div>
        <div style={MUTED}>
          {lead ? <>For <b style={{ color: 'var(--fg, #e2e8f0)' }}>{lead.name}</b>. </> : null}
          {sharedMode
            ? 'For a concrete contractor, a Facebook post or chat - one link for many people. Each person designs their building (no prices) and taps “Send to my steel building rep”; every design lands on Customer Designs.'
            : 'The customer designs the building in 3D (no prices) and taps “Send to my steel building rep”.'}
          {lead ? ' It shows on this lead under Customer Designs.' : ''}
        </div>
      </div>
      <button type="button" onClick={onClose} aria-label="Close" className="btn-secondary" style={{ padding: '4px 10px' }}>✕</button>
    </div>
  )

  let body
  if (picking) {
    body = (
      <>
        <label style={LBL} htmlFor="dl-search">Which lead is this for?</label>
        <input id="dl-search" style={FIELD} autoFocus placeholder="Search name, phone or email" value={search} onChange={(e) => setSearch(e.target.value)} />
        <div style={{ maxHeight: 300, overflow: 'auto', marginTop: 8, border: '1px solid var(--line, #294059)', borderRadius: 8 }}>
          {leads === null ? <div style={{ ...MUTED, padding: 10 }}>Loading leads…</div>
            : shown.length === 0 ? <div style={{ ...MUTED, padding: 10 }}>No lead matches.</div>
            : shown.map((c) => (
              <button key={c.id} type="button" onClick={() => choose(c)}
                style={{ display: 'flex', width: '100%', justifyContent: 'space-between', gap: 10, padding: '8px 10px', background: 'none', border: 0, borderBottom: '1px solid var(--line, #294059)', color: 'var(--fg, #e2e8f0)', textAlign: 'left', cursor: 'pointer' }}>
                <b style={{ fontWeight: 600 }}>{c.name || '—'}</b>
                <span style={MUTED}>{c.phone || c.email || ''}</span>
              </button>
            ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginTop: 12 }}>
          <span style={MUTED}>One person who is not a lead yet? The design waits on Customer Designs.</span>
          <button type="button" className="btn-secondary" onClick={() => { setPicking(false); make(null) }}>No lead yet: make the link</button>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginTop: 10 }}>
          <span style={MUTED}>A contractor or a Facebook post / chat - many people on one link?</span>
          <button type="button" className="btn-secondary" onClick={() => { setPicking(false); setSharedMode(true) }}>Shared link</button>
        </div>
      </>
    )
  } else if (sharedMode && !link) {
    const okName = sharedLabelOk(label)
    body = (
      <>
        <label style={LBL} htmlFor="dl-label">Name it: who will share it?</label>
        <input id="dl-label" style={FIELD} autoFocus maxLength={80} placeholder="e.g. ABC Concrete, Facebook Messenger" value={label} onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && okName && !busy) make(null, label.trim()) }} />
        <div style={{ ...MUTED, marginTop: 6 }}>Every design from this link shows "From: {label.trim() || 'this name'}". The link works for {Math.round(SHARED_LINK_DAYS / 365)} years; turn it off any time under Customer Designs › Shared links.</div>
        {label && !okName ? <div style={{ color: '#f0883e', fontSize: 12.5, marginTop: 6 }}>Please use letters, numbers and simple punctuation (up to 80).</div> : null}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
          <button type="button" className="btn-primary" disabled={!okName || busy} onClick={() => make(null, label.trim())}>{busy ? 'Making the link…' : 'Make the shared link'}</button>
        </div>
      </>
    )
  } else if (!link && step === 'quote') {
    const live = quotes.filter((q) => q.status !== 'superseded')
    const replaced = quotes.filter((q) => q.status === 'superseded')
    const row = (q) => {
      const why = quotePickerReason(q)
      return (
        <label key={q.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 9, padding: '8px 10px', borderBottom: '1px solid var(--line, #294059)', cursor: why ? 'not-allowed' : 'pointer', opacity: why ? 0.55 : 1 }}>
          <input type="radio" name="dl-quote" style={{ marginTop: 3 }} disabled={!!why} checked={pick === q.id} onChange={() => { setPick(q.id); setPickErr('') }} />
          <span style={{ minWidth: 0 }}>
            <span style={{ fontWeight: 600 }}>{quoteRowText(q)}</span>
            {why ? <span style={{ ...MUTED, display: 'block' }}>{why}</span> : null}
          </span>
        </label>
      )
    }
    body = (
      <>
        <div style={{ ...LBL, marginTop: 14 }}>Which building should the link open on?</div>
        <div style={{ maxHeight: 300, overflow: 'auto', border: '1px solid var(--line, #294059)', borderRadius: 8 }} role="radiogroup" aria-label="Quote to start the customer on">
          {live.map(row)}
          {replaced.length ? <div style={{ ...MUTED, padding: '8px 10px 2px', fontWeight: 700, textTransform: 'uppercase', fontSize: 11 }}>Replaced quotes</div> : null}
          {replaced.map(row)}
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 9, padding: '8px 10px', cursor: 'pointer' }}>
            <input type="radio" name="dl-quote" style={{ marginTop: 3 }} checked={pick === 'blank'} onChange={() => { setPick('blank'); setPickErr('') }} />
            <span style={{ fontWeight: 600 }}>A blank building <span style={{ ...MUTED, fontWeight: 400 }}>(customer starts from scratch)</span></span>
          </label>
        </div>
        {pickErr ? <div style={{ color: '#f0883e', fontSize: 12.5, marginTop: 8 }} role="alert">{pickErr}</div> : null}
        <div style={{ ...MUTED, marginTop: 8 }}>
          The customer sees the building from the saved quote, never prices. They change what they like and send it back; you see what changed.
          {quote?.id ? ' Uses the saved quote, not unsaved changes.' : ''}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
          <button type="button" className="btn-primary" disabled={busy} onClick={confirmQuote}>{pick === 'blank' ? 'Make a blank link' : 'Use this building'}</button>
        </div>
      </>
    )
  } else if (!link && step === 'lookup') {
    body = (
      <>
        <div style={{ color: '#f0883e', fontSize: 13, marginTop: 14 }} role="alert">Could not look up this lead’s quotes, so the link was not made.</div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => make(lead)}>Make a blank link instead</button>
          <button type="button" className="btn-primary" disabled={busy} onClick={() => { setStep(''); startQuoteStep(lead) }}>Try again</button>
        </div>
      </>
    )
  } else if (!link && step === 'preparing') {
    body = <div style={{ ...MUTED, padding: '18px 0' }} role="status">{progress || 'Preparing their building…'}</div>
  } else if (!link && step === 'review' && pack) {
    body = (
      <>
        <div style={{ ...LBL, marginTop: 14 }}>The link will open on</div>
        <div style={{ fontWeight: 700 }}>{designSummary(pack.seed) || 'Their building'}</div>
        <div style={MUTED}>from quote #{pack.quote.quote_number || '—'}. No prices, names or phone numbers go on the link.</div>
        {pack.notes.length ? (
          <>
            <div style={{ ...LBL, marginTop: 12 }}>Not on the customer’s page</div>
            <ul style={{ margin: '4px 0 0', paddingLeft: 18, maxHeight: 220, overflow: 'auto', fontSize: 12.5, lineHeight: 1.5 }}>
              {pack.notes.map((n) => <li key={n}>{n}</li>)}
            </ul>
          </>
        ) : <div style={{ ...MUTED, marginTop: 10 }}>Everything on this quote shows on the customer’s page.</div>}
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 14 }}>
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => setStep('quote')}>Back</button>
          <button type="button" className="btn-primary" disabled={busy} onClick={() => make(lead, undefined, pack)}>{busy ? 'Making the link…' : 'Make the link'}</button>
        </div>
      </>
    )
  } else if (!link) {
    body = <div style={{ ...MUTED, padding: '14px 0' }}>{busy ? 'Making the link…' : err ? '' : 'Getting ready…'}</div>
  } else {
    const phone = lead?.phone
    const email = lead?.email
    body = (
      <>
        <label style={LBL} htmlFor="dl-url">{sharedMode ? `Shared link: ${label.trim()}` : 'Their link'}</label>
        <div style={{ display: 'flex', gap: 6 }}>
          <input id="dl-url" style={{ ...FIELD, fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 12.5 }} readOnly value={link.url} onFocus={(e) => e.target.select()} />
          <button type="button" className="btn-primary" style={{ whiteSpace: 'nowrap' }} onClick={() => copyText(link.url, 'Link')}>Copy link</button>
        </div>
        <label style={LBL} htmlFor="dl-msg">Message (edit it if you like)</label>
        <textarea id="dl-msg" style={{ ...FIELD, minHeight: 130, resize: 'vertical', lineHeight: 1.45 }} value={msg} onChange={(e) => { setMsgEdited(true); setMsg(e.target.value) }} />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
          <button type="button" className="btn-secondary" onClick={() => copyText(msg, 'Message')}>Copy message</button>
          {phone ? (
            <a className="btn-secondary" style={{ textDecoration: 'none' }} href={rcTextHref(phone)} onClick={() => { copyText(msg, 'Message') }} title="Copies the message, then opens a RingCentral text to this number: paste it in">
              Text in RingCentral
            </a>
          ) : null}
          {email ? (
            <a className="btn-secondary" style={{ textDecoration: 'none' }} href={`mailto:${String(email).trim()}?subject=${encodeURIComponent('Design your building in 3D')}&body=${encodeURIComponent(msg)}`}>
              Email it
            </a>
          ) : null}
          <span style={{ flex: 1 }} />
          <button type="button" className="btn-primary" onClick={onClose}>Done</button>
        </div>
        <div style={{ ...MUTED, marginTop: 10 }}>
          {phone ? 'Text in RingCentral copies the message first: paste it into the text. ' : ''}
          {sharedMode
            ? `Give it to the contractor or post it. It works for ${Math.round(SHARED_LINK_DAYS / 365)} years; each design shows up on Customer Designs (not on a lead yet).`
            : pack ? `The link opens on the building from quote #${pack.quote.quote_number || '—'} and works for 120 days. Nothing is sent until you send it.`
              : 'The link works for 120 days. Nothing is sent until you send it.'}
        </div>
        {pack && pack.notes.length ? (
          <details style={{ ...MUTED, marginTop: 8 }}>
            <summary style={{ cursor: 'pointer' }}>Not on the customer’s page ({pack.notes.length})</summary>
            <ul style={{ margin: '4px 0 0', paddingLeft: 18, lineHeight: 1.5 }}>{pack.notes.map((n) => <li key={n}>{n}</li>)}</ul>
          </details>
        ) : null}
      </>
    )
  }

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="Send design link"
      style={{ position: 'fixed', inset: 0, zIndex, background: 'rgba(4,9,16,.62)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose() }}>
      <div style={{ width: 'min(600px, calc(100vw - 32px))', maxHeight: 'calc(100vh - 64px)', overflow: 'auto', background: 'var(--card, #0D1929)', border: '1px solid var(--line, #294059)', borderRadius: 14, padding: 18, boxShadow: '0 18px 60px rgba(0,0,0,.5)' }}>
        {head}
        {err || leadsErr ? <div className="error-banner" style={{ marginTop: 12 }}>{err || leadsErr}</div> : null}
        {body}
      </div>
    </div>,
    document.body,
  )
}
