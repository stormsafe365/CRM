// DocumentHub: per-client file repository. Files live in Supabase Storage
// (private bucket, namespaced by client + category) and open via short-lived
// signed URLs. Styled to the design's Document Hub — 6 category cards that
// filter a combined file table; upload targets the active category.
//
// Contracts, SORTED (owner 10/19/26, Peter Mawn: "he doesnt have 19 contracts ... its a rats nest and
// there is no way to mark the contract thats signed"): every Generate Contract / Executed Copy /
// revision adds a file, so the Contracts tab is no longer a flat list —
//   SIGNED          one card per agreement: the original and each revision the customer signed, the
//                   day he signed (typed by the rep), the signed copy, the DEPOSIT PAID copy, and a
//                   ▾ menu: See the signed copy · Make a revision · Change the signed date · …
//   NOT SIGNED YET  contracts we generated, one row per contract number (older copies folded)
//   UPLOADS TO SORT files with no contract number that are not linked to a signed order
// "Mark as signed…" (MarkSignedModal) replaces the old stamp icon; uploading a contract asks right
// away whether it is the signed copy. Nothing is renamed, moved or deleted by the sorting
// (lib/contractDocs organizeContracts); the trash can still deletes a file.

import { useEffect, useMemo, useRef, useState } from 'react'
import { uploadClientDoc, uploadClientDocBlob, listClientDocs, getDocSignedUrl, deleteDoc } from '../lib/storage'
import { stampExecutedPdf } from '../lib/stampExecuted'
import { supabase } from '../lib/supabase'
import { promoteToWorking } from '../lib/promoteLead'
import { useAuth } from '../context/AuthContext'
import { openMenu, toast } from '../lib/uiFx'
import LayoutSheetModal from './LayoutSheetModal'
import MarkSignedModal, { quoteLine } from './MarkSignedModal'
import {
  clearSignedMark, fmtShortDate, groupByLabel, markExecuted, organizeContracts, restoreAfterRevisionDeleted,
} from '../lib/contractDocs'
import { isBuilderPayload } from '../lib/priceLockCrm'

const SECTIONS = [
  { key: 'quote',       label: 'Quotes',      accept: 'application/pdf',         hint: 'PDF' },
  { key: 'contract',    label: 'Contracts',   accept: 'application/pdf,image/*', hint: 'PDF, scan or photo' },
  { key: 'rendering',   label: 'Renderings',  accept: 'image/*,application/pdf', hint: 'Image or PDF' },
  { key: 'layout',      label: 'Layout',      accept: 'application/pdf,image/*', hint: 'Signed sheet' },
  { key: 'revisions',   label: 'Revisions',   accept: 'application/pdf,image/*', hint: 'PDF or image' },
  { key: 'additional',  label: 'Additional',  accept: '',                        hint: 'Any file' },
]

const ic = (paths) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{paths}</svg>
const ICONS = {
  all:         ic(<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></>),
  quote:       ic(<><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></>),
  contract:    ic(<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" /></>),
  rendering:   ic(<><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.5-3.5L8 21" /></>),
  layout:      ic(<><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" /></>),
  revisions:   ic(<><path d="M3 3v5h5" /><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" /><path d="M12 7v5l3 2" /></>),
  additional:  ic(<><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z" /><path d="M12 11v5M9.5 13.5h5" /></>),
}
const EYE = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></svg>
const TRASH = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>
const CHECK = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
const CHEV = <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>

// 6A category accents (rotating palette; All Files uses the brand teal) + short chip labels.
const CAT_ACCENT = { all: '#22c4bf', quote: '#61d89e', contract: '#ff9351', rendering: '#9da9dd', layout: '#ffeb99', revisions: '#22c4bf', additional: '#61d89e' }
const CHIP_LABEL = { quote: 'Quote', contract: 'Contract', rendering: 'Render', layout: 'Layout', revisions: 'Revision', additional: 'Extra' }
const hexRgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})` }
const accentVars = (accent) => ({
  '--accent': accent, '--ring': hexRgba(accent, 0.40), '--soft': hexRgba(accent, 0.20),
  '--tile': hexRgba(accent, 0.14), '--tileBd': hexRgba(accent, 0.32),
  '--chipBg': hexRgba(accent, 0.12), '--chipBd': hexRgba(accent, 0.38),
})

const labelSingular = (key) => SECTIONS.find(s => s.key === key)?.label.replace(/s$/, '') || key
const fmtDate = (iso) => {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) }
  catch { return '—' }
}
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const labelOfPath = (p) => String(p || '').split('/').pop().replace(/^\d+-/, '')

export default function DocumentHub({ clientId, clientName, client, onBuildQuote }) {
  const { user } = useAuth()
  const [filesByCat, setFilesByCat] = useState({})
  const [quotes, setQuotes] = useState([])
  const [loading, setLoading] = useState(true)
  const [active, setActive] = useState('all')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [layoutOpen, setLayoutOpen] = useState(false)
  const [markFor, setMarkFor] = useState(null) // { file, presetQuoteId, justUploaded } — Mark as signed
  const [dateFor, setDateFor] = useState(null) // quote id — change the signed date
  const [open, setOpen] = useState(() => new Set()) // folded groups the rep opened
  const [stamping, setStamping] = useState(null)
  const inputRef = useRef(null)
  const uploadCat = useRef('quote')
  const attachFor = useRef(null) // "Attach the signed copy" of this quote id
  const [docExpanded, setDocExpanded] = useState(false)
  const selectCat = (key) => { setActive(key); setDocExpanded(false) }
  const toggle = (k) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n })

  async function loadQuotes() {
    try {
      const { data, error } = await supabase.from('quotes').select('*').eq('client_id', clientId)
      if (error) throw error
      setQuotes((data || []).filter((q) => q && !q.deleted_at))
    } catch (e) { console.warn('Doc Hub: quotes not read', e) }
  }
  async function refresh() {
    try {
      const entries = await Promise.all(SECTIONS.map(async s => [s.key, await listClientDocs(clientId, s.key)]))
      setFilesByCat(Object.fromEntries(entries))
      setError('')
    } catch (e) { setError(e.message) } finally { setLoading(false) }
    loadQuotes()
  }

  useEffect(() => { setLoading(true); refresh() /* eslint-disable-next-line */ }, [clientId])

  // Storage has no realtime — refresh when a quote/contract PDF is saved to this
  // lead from the builder (BuildQuoteModal dispatches ss:docs-updated). The
  // lead's quotes (signed marks) do: their own channel.
  useEffect(() => {
    const onDocs = (e) => { if (!e.detail || e.detail.clientId === clientId) refresh() }
    window.addEventListener('ss:docs-updated', onDocs)
    const channel = supabase
      .channel(`dochub-quotes-${clientId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'quotes', filter: `client_id=eq.${clientId}` }, () => loadQuotes())
      .subscribe()
    return () => { window.removeEventListener('ss:docs-updated', onDocs); supabase.removeChannel(channel) }
    /* eslint-disable-next-line */
  }, [clientId])

  const org = useMemo(() => organizeContracts(filesByCat.contract || [], quotes), [filesByCat.contract, quotes])
  // files a signed order points at: deleting one asks twice
  const signedPaths = useMemo(() => {
    const m = new Map()
    for (const s of org.signed) {
      if (s.signedFile) m.set(s.signedFile.path, `the signed copy of ${quoteLine(s.quote)}`)
      if (s.stampedFile) m.set(s.stampedFile.path, `the DEPOSIT PAID copy of ${quoteLine(s.quote)}`)
    }
    return m
  }, [org])

  const counts = Object.fromEntries(SECTIONS.map(s => [s.key, (filesByCat[s.key] || []).length]))
  const total = Object.values(counts).reduce((a, b) => a + b, 0)

  function triggerUpload(cat) {
    uploadCat.current = cat
    const sec = SECTIONS.find(s => s.key === cat)
    if (inputRef.current) { inputRef.current.accept = sec?.accept || ''; inputRef.current.click() }
  }
  async function onPick(e) {
    const file = e.target.files?.[0]
    const attachTo = attachFor.current
    attachFor.current = null
    if (!file) return
    setBusy(true); setError('')
    try {
      const cat = uploadCat.current
      const path = await uploadClientDoc(clientId, cat, file)
      // Uploading a quote PDF should also appear in the Quotes box — create a
      // quote record that points at the uploaded file. Size is parsed from the
      // filename (e.g. "…24x30x14.pdf") when present.
      if (cat === 'quote') {
        const m = file.name.match(/(\d+)\s*[xX]\s*(\d+)(?:\s*[xX]\s*(\d+))?/)
        const size = m ? [m[1], m[2], m[3]].filter(Boolean).join('x') : null
        await supabase.from('quotes').insert({
          client_id: clientId,
          quote_date: new Date().toISOString().slice(0, 10),
          building_size: size,
          status: 'draft',
          pdf_snapshot_url: path,
          notes: file.name.replace(/\.[^.]+$/, ''),
          created_by: user?.id ?? null,
        })
        promoteToWorking(clientId, user?.id).catch(() => {})
      }
      await refresh()
      // a contract upload: is it what the customer signed? (owner 10/19/26)
      if (cat === 'contract') { setActive('contract'); setMarkFor({ file: { path, label: labelOfPath(path) }, presetQuoteId: attachTo, justUploaded: true }) }
    }
    catch (err) { setError(err.message) }
    finally { setBusy(false); if (inputRef.current) inputRef.current.value = '' }
  }
  async function onView(path) {
    try { window.open(await getDocSignedUrl(path), '_blank') } catch (e) { setError(e.message) }
  }

  async function onDelete(path) {
    const linked = signedPaths.get(path)
    if (linked && !window.confirm(`This is ${linked}. Delete it anyway? The order stays marked signed.`)) return
    if (!window.confirm('Delete this file? This cannot be undone.')) return
    try {
      await deleteDoc(path)
      // Mirror: if a quote is backed by this exact PDF, soft-delete that quote too
      // so the Quotes box updates in lockstep (its realtime picks up the change).
      // No-op for non-quote files (contracts/renderings) — no row points at them.
      try {
        const { data: gone } = await supabase.from('quotes')
          .update({ deleted_at: new Date().toISOString(), deleted_by: user?.id ?? null })
          .eq('client_id', clientId).eq('pdf_snapshot_url', path)
          .select('id')
        // a deleted revision gives the order it replaced back its place (owner 10/19/26)
        for (const g of gone || []) { try { await restoreAfterRevisionDeleted(supabase, g.id) } catch (e) { console.warn('order not restored', e) } }
      } catch { /* the file is deleted regardless */ }
      await refresh()
    } catch (e) { setError(e.message) }
  }

  // The signed order's DEPOSIT PAID copy, made later from its signed copy.
  async function makeStamped(s) {
    if (stamping || !s.signedFile) return
    setStamping(s.quote.id)
    try {
      const res = await fetch(await getDocSignedUrl(s.signedFile.path))
      if (!res.ok) throw new Error('Could not download the signed copy.')
      const ct = res.headers.get('content-type') || (/\.(png|jpe?g)$/i.test(s.signedFile.label) ? 'image/jpeg' : 'application/pdf')
      const blob = await stampExecutedPdf(new Uint8Array(await res.arrayBuffer()), ct)
      const stampedPath = await uploadClientDocBlob(clientId, 'contract', blob, `${s.signedFile.label.replace(/\.[^.]+$/, '')}-EXECUTED-deposit-paid.pdf`, 'application/pdf')
      await markExecuted(supabase, s.quote.id, { stampedPath })
      toast('DEPOSIT PAID copy made — saved under Contracts', 'success')
      await refresh()
    } catch (e) { setError('Could not make the DEPOSIT PAID copy: ' + (e.message || e)) }
    finally { setStamping(null) }
  }

  function signedMenu(e, s, latest) {
    const q = s.quote
    const items = []
    if (s.signedFile) items.push({ id: 'see', label: 'See the signed copy', onClick: () => onView(s.signedFile.path) })
    else items.push({ id: 'attach', label: 'Attach the signed copy (upload)…', onClick: () => { attachFor.current = q.id; triggerUpload('contract') } })
    if (s.stampedFile) items.push({ id: 'stamped', label: 'See the DEPOSIT PAID copy', onClick: () => onView(s.stampedFile.path) })
    else if (s.signedFile) items.push({ id: 'stamp', label: 'Make the DEPOSIT PAID copy', onClick: () => makeStamped(s) })
    if (latest) {
      items.push({ sep: true })
      items.push({
        id: 'rev', label: 'Make a revision of this signed version',
        onClick: () => {
          if (!isBuilderPayload(q.payload_json)) { toast('This order was added by hand — there is no build to revise. Build it in the 3D quote builder first.'); return }
          window.dispatchEvent(new CustomEvent('ss:make-revision', { detail: { clientId, quoteId: q.id } }))
        },
      })
    }
    items.push({ sep: true })
    items.push({ id: 'date', label: s.confirmed ? 'Change the signed date…' : 'Set the date he signed…', onClick: () => setDateFor(q.id) })
    items.push({
      id: 'unmark', label: 'Not signed — take the mark off', cls: 'danger',
      onClick: async () => {
        if (!window.confirm(`Take the signed mark off ${quoteLine(q)}? The files stay; the quote's status is not changed (set it on the quote card if needed).`)) return
        try { await clearSignedMark(supabase, q.id); toast(`${esc(quoteLine(q))} is no longer marked signed`, 'success'); loadQuotes() }
        catch (err) { setError(err.message || String(err)) }
      },
    })
    openMenu(e.currentTarget, esc(quoteLine(q)), items.map((it) => (it.sep ? it : { ...it, label: esc(it.label) })))
  }

  const activeAccent = CAT_ACCENT[active] || '#14A6A0'
  // "#SS-2026-50001 (Revision 1)" — the quote that replaced a signed one
  const replacedByText = (q) => {
    const by = q.payload_json?.revisedBy
    const rq = by && quotes.find((x) => x.id === by.id)
    return rq ? quoteLine(rq).replace(/ of SS-[\d-]+$/, '') : `#${(by && by.quote_number) || '—'}`
  }

  const chipOf = (p) => { const t = signedPaths.get(p); return t ? (t.startsWith('the DEPOSIT') ? 'Deposit paid' : 'Signed copy') : null }

  // one file row (the table's 4 columns); `more` = folded older copies of the same file
  function fileRow({ f, cat, note = null, more = null, gkey = null, signed = false, sub = false, chip = null }) {
    const acc = CAT_ACCENT[cat] || '#14A6A0'
    const canMark = cat === 'contract' && !signedPaths.has(f.path)
    return (
      <div key={f.path} className={`doc-row${sub ? ' doc-row-sub' : ''}`} style={accentVars(acc)}>
        <span className="doc-name" role="button" onClick={() => onView(f.path)} title={f.label}>
          <span className="doc-name-ic">{ICONS[cat]}</span>
          <span className="doc-name-txt">{f.label}{note && <span className="doc-note">{note}</span>}</span>
          {more > 0 && (
            <button type="button" className="doc-more" onClick={(e) => { e.stopPropagation(); toggle(gkey) }} title="Older copies of the same file">
              {open.has(gkey) ? 'hide' : `+${more} older ${more === 1 ? 'copy' : 'copies'}`}
            </button>
          )}
        </span>
        <span>{signed ? <span className="doc-chip doc-chip-signed">{chip || 'Signed'}</span> : <span className="doc-chip">{chip || CHIP_LABEL[cat] || labelSingular(cat)}</span>}</span>
        <span className="doc-date num">{fmtDate(f.createdAt)}</span>
        <span className="doc-acts">
          {canMark && <button type="button" className="doc-mark" title="Mark as signed — this is what the customer signed" onClick={() => setMarkFor({ file: f, presetQuoteId: null, justUploaded: false })}>{CHECK}</button>}
          <button type="button" title="View" onClick={() => onView(f.path)}>{EYE}</button>
          <button type="button" title="Delete" className="del" onClick={() => onDelete(f.path)}>{TRASH}</button>
        </span>
      </div>
    )
  }
  const groupRows = (groups, cat) => groups.flatMap((g) => {
    const k = `${cat}:${g.latest.label.toLowerCase()}`
    return [
      fileRow({ f: g.latest, cat: cat, more: g.older.length, gkey: k, signed: signedPaths.has(g.latest.path), chip: chipOf(g.latest.path) }),
      ...(open.has(k) ? g.older.map((f) => fileRow({ f: f, cat: cat, sub: true, signed: signedPaths.has(f.path) })) : []),
    ]
  })

  // ── the Contracts tab, sorted ──
  function contractsView() {
    const hasSigned = org.agreements.length > 0
    const unsignedOpen = !hasSigned || open.has('contract:unsigned')
    const nUnsigned = org.unsigned.reduce((n, g) => n + 1 + g.older.length, 0)
    if (!(filesByCat.contract || []).length && !hasSigned) return <div className="doc-empty">No contracts yet. Generate one from a quote, or upload the signed copy.</div>
    return (
      <div className="ctr">
        <div className="ctr-h"><span className="ctr-h-dot ok" />Signed {hasSigned ? `· ${org.signed.length}` : ''}</div>
        {!hasSigned && <p className="ctr-empty">Nothing is marked signed yet. Upload the signed contract (DocuSign download, scan or photo) and mark it — or tap ✓ on the one he signed below.</p>}
        {org.agreements.map((a) => (
          <div key={a.agreement} className="ctr-agr">
            <div className="ctr-agr-h">Agreement <b>{a.agreement}</b></div>
            {a.entries.map((s) => {
              const latest = s === a.latest
              const gk = `contract:gen:${s.quote.id}`
              return (
                <div key={s.quote.id} className={`ctr-sig${latest ? ' now' : ''}`}>
                  <div className="ctr-sig-top">
                    <span className="ctr-sig-ic">{CHECK}</span>
                    <span className="ctr-sig-main">
                      <b>{s.role}</b>
                      <span className="ctr-sig-sub">#{s.quote.quote_number || '—'} · {s.confirmed
                        ? <>signed <b className="ctr-day">{fmtShortDate(s.signedOn)}</b></>
                        : <button type="button" className="ctr-setday" onClick={() => setDateFor(s.quote.id)}>set the date he signed ✎</button>}
                        {latest && s.current && <span className="ctr-now">the order now</span>}
                        {latest && !s.current && <span className="ctr-warn">latest signed version · replaced by {replacedByText(s.quote)} — not marked signed</span>}
                        {!latest && <span className="ctr-old">replaced by a later signed revision</span>}
                      </span>
                    </span>
                    <button type="button" className="ctr-menu" data-menu-anchor onClick={(e) => signedMenu(e, s, latest)}>Actions {CHEV}</button>
                  </div>
                  <div className="ctr-files">
                    {s.signedFile
                      ? fileRow({ f: s.signedFile, cat: "contract", signed: true, chip: "Signed copy" })
                      : <div className="ctr-missing">No signed copy attached. <button type="button" onClick={() => { attachFor.current = s.quote.id; triggerUpload('contract') }}>Attach it</button></div>}
                    {s.stampedFile && fileRow({ f: s.stampedFile, cat: "contract", signed: true, chip: "Deposit paid" })}
                    {stamping === s.quote.id && <div className="ctr-missing">Making the DEPOSIT PAID copy…</div>}
                    {s.generated.length > 0 && (
                      <button type="button" className="ctr-fold" onClick={() => toggle(gk)}>
                        {open.has(gk) ? 'Hide' : 'Show'} the {s.generated.length} {s.generated.length === 1 ? 'copy' : 'copies'} we generated for this number
                      </button>
                    )}
                    {open.has(gk) && s.generated.map((f) => fileRow({ f: f, cat: "contract", sub: true, chip: "Generated" }))}
                  </div>
                </div>
              )
            })}
          </div>
        ))}

        {org.unsigned.length > 0 && (
          <>
            <button type="button" className="ctr-h ctr-h-btn" onClick={() => toggle('contract:unsigned')} disabled={!hasSigned}>
              <span className="ctr-h-dot" />Not signed · contracts we generated · {nUnsigned} {nUnsigned === 1 ? 'file' : 'files'}
              {hasSigned && <span className={`ctr-chev${unsignedOpen ? ' flip' : ''}`}>{CHEV}</span>}
            </button>
            {unsignedOpen && org.unsigned.map((g) => {
              const k = `contract:num:${g.number.toLowerCase()}`
              const note = g.quote ? `${quoteLine(g.quote)}${g.old ? ' · replaced' : ''}` : 'no quote has this number'
              return [
                fileRow({ f: g.latest, cat: "contract", note: note, more: g.older.length, gkey: k }),
                ...(open.has(k) ? g.older.map((f) => fileRow({ f: f, cat: "contract", sub: true })) : []),
              ]
            })}
          </>
        )}

        {org.uploads.length > 0 && (
          <>
            <div className="ctr-h"><span className="ctr-h-dot warn" />Uploads to sort · tap ✓ if it is what the customer signed</div>
            {org.uploads.map((f) => fileRow({ f: f, cat: "contract" }))}
          </>
        )}
      </div>
    )
  }

  // the flat views (All Files / one category): same-named copies folded under the newest
  const flatGroups = active === 'all'
    ? SECTIONS.flatMap((s) => groupByLabel(filesByCat[s.key] || []).map((g) => ({ ...g, cat: s.key })))
    : groupByLabel(filesByCat[active] || []).map((g) => ({ ...g, cat: active }))
  const visibleGroups = docExpanded ? flatGroups : flatGroups.slice(0, 6)

  return (
    <section className="doc-hub" style={accentVars(activeAccent)}>
      {/* Header bar */}
      <div className="doc-hub-head">
        <span className="doc-hub-mark" />
        <span className="doc-hub-title">Document Hub</span>
        <button className="doc-hub-ghost" onClick={() => setLayoutOpen(true)}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" /></svg>
          Open Layout
        </button>
        <button className="doc-hub-cta" onClick={() => triggerUpload(active === 'all' ? 'quote' : active)}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M17 8l-5-5-5 5M12 3v12" /></svg>
          {busy ? 'Uploading…' : active === 'contract' ? 'Upload signed copy' : 'Upload'}
        </button>
      </div>

      <input ref={inputRef} type="file" onChange={onPick} hidden />

      {/* Category grid — 6A centered cards with a per-category accent bar */}
      <div className="doc-cats-6a">
        <button className={`cat-card${active === 'all' ? ' on' : ''}`} style={accentVars(CAT_ACCENT.all)} onClick={() => selectCat('all')}>
          <span className="cat-bar" /><span className="cat-tile">{ICONS.all}</span>
          <span className="cat-nm">All Files</span><span className="cat-ct num">{total} files</span>
        </button>
        {SECTIONS.map(s => (
          <button key={s.key} className={`cat-card${active === s.key ? ' on' : ''}`} style={accentVars(CAT_ACCENT[s.key])} onClick={() => selectCat(s.key)}>
            <span className="cat-bar" /><span className="cat-tile">{ICONS[s.key]}</span>
            <span className="cat-nm">{s.label}</span>
            <span className="cat-ct num">{s.key === 'contract' && org.signed.length ? `${org.signed.length} signed · ${counts[s.key]} files` : `${counts[s.key]} files`}</span>
          </button>
        ))}
      </div>

      {error && <div className="error-banner" style={{ margin: '0 24px 12px' }}>{error}</div>}

      {/* File list */}
      {loading ? (
        <div className="muted" style={{ padding: 24 }}>Loading…</div>
      ) : active === 'contract' ? (
        <div className="doc-list">{contractsView()}</div>
      ) : flatGroups.length === 0 ? (
        <div className="doc-empty">No files in {active === 'all' ? 'this lead' : labelSingular(active).toLowerCase()} yet.</div>
      ) : (
        <div className="doc-list" key={`${active}-${docExpanded}`}>
          <div className="doc-list-head"><span>File Name</span><span>Category</span><span>Date</span><span className="r">Actions</span></div>
          {active === 'all' && org.signed.length > 0 && (
            <button type="button" className="ctr-jump" onClick={() => selectCat('contract')}>
              {CHECK} {org.signed.length === 1 ? 'Signed contract' : `${org.signed.length} signed contracts`} — see them under Contracts
            </button>
          )}
          {visibleGroups.flatMap((g) => groupRows([g], g.cat))}
          {flatGroups.length > 6 && (
            <button className="doc-showall" onClick={() => setDocExpanded(v => !v)}>
              {docExpanded ? 'Show less' : `Show all ${flatGroups.length}`}
              <svg className={docExpanded ? 'flip' : ''} viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
            </button>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="doc-hub-foot">
        <span className="num">{total} {total === 1 ? 'file' : 'files'}</span>
        <span className="num">Updated {fmtDate(new Date().toISOString())}</span>
      </div>

      {markFor && (
        <MarkSignedModal
          mode="mark" clientId={clientId} file={markFor.file} quotes={quotes} presetQuoteId={markFor.presetQuoteId} justUploaded={markFor.justUploaded}
          onClose={() => setMarkFor(null)} onDone={() => { setMarkFor(null); refresh() }}
        />
      )}
      {dateFor && (
        <MarkSignedModal
          mode="date" clientId={clientId} quotes={quotes} presetQuoteId={dateFor}
          onClose={() => setDateFor(null)} onDone={() => { setDateFor(null); loadQuotes() }}
        />
      )}
      {layoutOpen && <LayoutSheetModal client={client || { id: clientId, name: clientName }} onSaved={refresh} onClose={() => setLayoutOpen(false)} />}
    </section>
  )
}
