// LeadsExportPanel: the Leads page "Export" (owner 10/22/26) - a CSV of the leads for Google Sheets / Mailchimp,
// and a one-click "copy all emails". ADMIN ONLY: the page does not show the button to a rep, and this panel
// renders nothing unless the login is a confirmed admin (a second lock, same as the Performance page).
//
// Which leads: EVERY lead the admin can see (the full loaded list, deleted ones excluded) - not narrowed by the
// page's current tab, rep tab or search box. The status boxes below are the filter. All of it is computed here
// from the leads already loaded: no new query, no SQL, nothing leaves the computer.
// The rules (name split, one row per email, formula guard, BOM/CRLF) live in lib/leadExport.js.
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useIsAdmin } from '../lib/useIsAdmin'
import { buildLeadsCsv, emailList, exportSummary, leadsCsvFilename, statusCounts } from '../lib/leadExport'

// The CRM loads at most 1,000 leads at once (the database's own page size); at that count the export may be short.
const LOAD_CAP = 1000

const LBL = { display: 'block', fontSize: 11.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--fg-3, #8598AC)', margin: '16px 0 8px' }
const MUTED = { color: 'var(--fg-3, #8598AC)', fontSize: 12.5, lineHeight: 1.5 }
const BOX = { accentColor: 'var(--lime, #8FD14F)', width: 16, height: 16, margin: 0, flex: '0 0 auto', cursor: 'pointer' }
const LINKBTN = { background: 'none', border: 0, padding: 0, color: 'var(--cyan, #09D6DC)', fontFamily: 'inherit', fontSize: 12.5, cursor: 'pointer' }
const OFF = { opacity: 0.45, cursor: 'not-allowed' }

const plural = (n, one, many) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`

export default function LeadsExportPanel({ leads, users, onClose }) {
  const isAdmin = useIsAdmin()
  const [off, setOff] = useState(() => new Set())      // status boxes the owner UNticked (none = everything ticked)
  const [onlyEmail, setOnlyEmail] = useState(true)
  const [note, setNote] = useState(null)               // { text } shown under the buttons after Download / Copy
  const [fallback, setFallback] = useState(null)       // the emails as text, when the clipboard was blocked
  const fbRef = useRef(null)

  const counts = useMemo(() => statusCounts(leads), [leads])
  const statuses = counts.filter((s) => !off.has(s.key)).map((s) => s.key)
  const opts = { statuses, onlyWithEmail: onlyEmail, users }
  const summary = useMemo(() => exportSummary(leads, opts), [leads, off, onlyEmail, users]) // eslint-disable-line react-hooks/exhaustive-deps
  const emails = useMemo(() => emailList(leads, opts), [leads, off, onlyEmail, users])       // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Changing a box makes any earlier "Copied / ready" line stale.
  useEffect(() => { setNote(null); setFallback(null) }, [off, onlyEmail])
  useEffect(() => {
    if (fallback != null && fbRef.current) { fbRef.current.focus(); fbRef.current.select() }
  }, [fallback])

  if (isAdmin !== true) return null

  function toggle(key) {
    setOff((prev) => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n })
  }

  function download() {
    const csv = buildLeadsCsv(leads, opts)
    const name = leadsCsvFilename()
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' }) // the string already starts with the BOM
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 15000)
    setFallback(null)
    setNote({ text: `CSV ready: ${name} (${plural(summary.rows, 'row', 'rows')}). Save it if the app asks where.` })
  }

  async function copyEmails() {
    const text = emails.join('\n')
    let ok = false
    try {
      await navigator.clipboard.writeText(text)
      ok = true
    } catch {
      // the clipboard API can be blocked: try the old textarea way, then show the emails selected for Ctrl+C
      try {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.setAttribute('readonly', '')
        ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0'
        document.body.appendChild(ta)
        ta.select()
        ok = document.execCommand('copy')
        ta.remove()
      } catch { ok = false }
    }
    if (ok) {
      setFallback(null)
      setNote({ text: `Copied ${plural(emails.length, 'email', 'emails')}` })
    } else {
      setNote(null)
      setFallback(text)
    }
  }

  const noRows = summary.rows === 0
  const noEmails = emails.length === 0
  const ic = (d) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="Export leads"
      style={{ position: 'fixed', inset: 0, zIndex: 1300, background: 'rgba(4,9,16,.62)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ width: 'min(560px, calc(100vw - 32px))', maxHeight: 'calc(100vh - 64px)', overflow: 'auto', background: 'var(--card, #0D1929)', border: '1px solid var(--line, #294059)', borderRadius: 14, padding: 20, boxShadow: '0 18px 60px rgba(0,0,0,.5)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ fontFamily: 'var(--font-head)', fontSize: 15, letterSpacing: '.01em', textTransform: 'uppercase', color: 'var(--fg, #E7EEF4)' }}>Export leads</div>
            <div style={{ ...MUTED, marginTop: 4 }}>Every lead you can see, whatever tab or search the page is on. Deleted leads are never included.</div>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            {ic(<path d="M18 6 6 18M6 6l12 12" />)}
          </button>
        </div>

        {leads.length >= LOAD_CAP && (
          <div role="note" style={{ marginTop: 12, padding: '8px 11px', borderRadius: 8, border: '1px solid rgba(240,136,62,.5)', background: 'rgba(240,136,62,.08)', color: '#f0883e', fontSize: 12.5, lineHeight: 1.45 }}>
            The Leads page loads {LOAD_CAP.toLocaleString('en-US')} leads at most, and that many are loaded, so older leads may be missing from this export.
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <span style={LBL}>Which leads?</span>
          <span style={{ display: 'inline-flex', gap: 10 }}>
            <button type="button" style={LINKBTN} onClick={() => setOff(new Set())}>All</button>
            <button type="button" style={LINKBTN} onClick={() => setOff(new Set(counts.map((s) => s.key)))}>None</button>
          </span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(215px, 1fr))', gap: '8px 14px' }}>
          {counts.map((s) => (
            <label key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13.5, color: 'var(--fg, #E7EEF4)', cursor: 'pointer', padding: '5px 0' }}>
              <input type="checkbox" style={BOX} checked={!off.has(s.key)} onChange={() => toggle(s.key)} />
              <span style={{ flex: 1 }}>{s.label}</span>
              <span className="num" style={{ color: 'var(--fg-3, #8598AC)', fontSize: 12.5 }}>{s.count.toLocaleString('en-US')}</span>
            </label>
          ))}
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13.5, color: 'var(--fg, #E7EEF4)', cursor: 'pointer', marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--line-soft, #1D2F45)' }}>
          <input type="checkbox" style={BOX} checked={onlyEmail} onChange={(e) => setOnlyEmail(e.target.checked)} />
          Only leads that have an email
        </label>

        <div aria-live="polite" style={{ marginTop: 16, padding: '11px 14px', borderRadius: 10, background: 'var(--inset, #0B1B32)', border: '1px solid var(--line, #294059)' }}>
          <div style={{ fontSize: 14.5, color: 'var(--fg, #E7EEF4)', fontWeight: 600 }}>
            <span style={{ color: 'var(--lime, #8FD14F)' }}>{plural(summary.leads, 'lead', 'leads')}</span>, {plural(summary.emails, 'unique email', 'unique emails')}
          </div>
          {summary.leads > summary.rows && (
            <div style={{ ...MUTED, marginTop: 3 }}>Two leads with the same email become one row (the newest lead is kept).</div>
          )}
          {summary.malformed > 0 && (
            <div style={{ ...MUTED, marginTop: 3 }}>
              {summary.malformed === 1 ? '1 lead has an email' : `${summary.malformed.toLocaleString('en-US')} leads have an email`} that does not look right; that email is left out.
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 16 }}>
          <button type="button" className="btn btn-primary" onClick={download} disabled={noRows} style={noRows ? OFF : undefined}>
            {ic(<><path d="M12 3v12" /><path d="m7 11 5 5 5-5" /><path d="M5 21h14" /></>)}
            Download CSV
          </button>
          <button type="button" className="btn btn-ghost" onClick={copyEmails} disabled={noEmails} style={noEmails ? OFF : undefined}>
            {ic(<><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></>)}
            Copy all emails
          </button>
        </div>

        <div role="status" aria-live="polite" style={{ minHeight: 20, marginTop: 10, fontSize: 13.5, color: 'var(--lime, #8FD14F)', fontWeight: 600 }}>
          {note ? note.text : ''}
        </div>

        {fallback != null && (
          <div style={{ marginTop: 6 }}>
            <div style={{ ...MUTED, marginBottom: 6 }}>This computer would not let the app copy. The emails are selected below: press Ctrl+C.</div>
            <textarea ref={fbRef} readOnly value={fallback} aria-label="All emails" rows={6}
              style={{ width: '100%', boxSizing: 'border-box', background: 'var(--inset, #0B1B32)', color: 'var(--fg, #E7EEF4)', border: '1px solid var(--line, #294059)', borderRadius: 8, padding: '9px 11px', fontSize: 13, fontFamily: 'inherit' }} />
          </div>
        )}

        <div style={{ ...MUTED, marginTop: 12 }}>In Google Sheets: File &gt; Import &gt; Upload, or just paste the copied emails into a column.</div>
        <div style={{ ...MUTED, marginTop: 6 }}>Mailchimp needs permission to email these people; leads who asked to stop should not be included.</div>
      </div>
    </div>,
    document.body,
  )
}
