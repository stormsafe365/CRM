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
import { createDesignLink, designLinkMessage, logDesignLink } from '../lib/designLinks'

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

export default function DesignLinkModal({ client = null, onClose, zIndex = 1300 }) {
  const { user } = useAuth()
  const { users } = useUsers()
  const [lead, setLead] = useState(client)          // the lead the link is for (null = pick / none)
  const [picking, setPicking] = useState(!client)
  const [search, setSearch] = useState('')
  const [link, setLink] = useState(null)            // { token, url }
  const [msg, setMsg] = useState('')
  const [msgEdited, setMsgEdited] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const madeRef = useRef(false)
  const { leads, list: shown, err: leadsErr } = useLeadSearch(picking, search)

  // The customer reads this: the rep's DISPLAY name only (never an email or
  // "Unknown rep"); without one the message just says StormSafe Steel.
  const repFirst = users.find((u) => u.id === user?.id)?.display_name || ''

  // The message follows the lead / rep name (the user list may load after the
  // link) until the rep edits it.
  useEffect(() => {
    if (link && !msgEdited) setMsg(designLinkMessage({ clientName: lead?.name, repName: repFirst, url: link.url }))
  }, [link, lead, repFirst, msgEdited])

  async function make(forLead) {
    if (madeRef.current) return
    madeRef.current = true
    setBusy(true); setErr('')
    try {
      const l = await createDesignLink(supabase, { clientId: forLead?.id ?? null, userId: user?.id ?? null })
      setLink(l)
      try { await logDesignLink(supabase, { clientId: forLead?.id, userId: user?.id, url: l.url }) } catch { /* timeline entry is best-effort */ }
    } catch (e) {
      madeRef.current = false
      setErr(e.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  // Lead known: make the link right away.
  useEffect(() => {
    if (client?.id) make(client)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function choose(c) {
    setLead(c); setPicking(false)
    make(c)
  }

  const head = (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
      <div>
        <div style={{ fontSize: 16, fontWeight: 800 }}>Send design link</div>
        <div style={MUTED}>
          {lead ? <>For <b style={{ color: 'var(--fg, #e2e8f0)' }}>{lead.name}</b>. </> : null}
          The customer designs the building in 3D (no prices) and taps “Send to my steel building rep”.
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
          <span style={MUTED}>Not a lead yet? The design will wait under Leads › Customer designs.</span>
          <button type="button" className="btn-secondary" onClick={() => { setPicking(false); make(null) }}>No lead yet: make the link</button>
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
        <label style={LBL} htmlFor="dl-url">Their link</label>
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
          The link works for 120 days. Nothing is sent until you send it.
        </div>
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
