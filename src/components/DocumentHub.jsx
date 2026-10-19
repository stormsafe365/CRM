// DocumentHub: per-client file repository. Files live in Supabase Storage
// (private bucket, namespaced by client + category) and open via short-lived
// signed URLs.
//
// CURRENT / HISTORY (owner 10/19/26: "right now its a MESSSSSS"; ideas from a ChatGPT guide she sent):
//   top       three counts (Signed · Current · History), a search box, a chip per kind of file
//   CURRENT   the signed agreement (its latest signed version), the order as it stands (the current
//             quote's PDF) and the latest Revision Order — what matters now
//   HISTORY   every other file, folded by kind, same-named copies folded under the newest, with
//             tick-boxes: tick the junk drafts and delete them in one go (asked once, never silently;
//             files a signed order points at are skipped)
// Contracts, SORTED (owner 10/19/26, Peter Mawn): the Contracts chip shows Signed / Not signed /
// Uploads to sort (lib/contractDocs organizeContracts); "Mark as signed" (MarkSignedModal) records the
// day and the contract number on the paper; uploading a contract asks right away whether it is the
// signed copy. Nothing is renamed, moved or deleted by the sorting.

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
  clearSignedMark, contractRoleOf, currentOrderQuote, fmtShortDate, groupByLabel, markExecuted, organizeContracts, restoreAfterRevisionDeleted,
} from '../lib/contractDocs'
import { isBuilderPayload } from '../lib/priceLockCrm'
import { quoteStatusLabel } from '../lib/constants'

const SECTIONS = [
  { key: 'quote',       label: 'Quotes',      accept: 'application/pdf',         hint: 'PDF' },
  { key: 'contract',    label: 'Contracts',   accept: 'application/pdf,image/*', hint: 'PDF, scan or photo' },
  { key: 'revisions',   label: 'Revisions',   accept: 'application/pdf,image/*', hint: 'PDF or image' },
  { key: 'rendering',   label: 'Renderings',  accept: 'image/*,application/pdf', hint: 'Image or PDF' },
  { key: 'layout',      label: 'Layout',      accept: 'application/pdf,image/*', hint: 'Signed sheet' },
  { key: 'additional',  label: 'Other',       accept: '',                        hint: 'Any file' },
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
const SEARCH = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>

// category accents (rotating palette; All uses the brand teal) + short chip labels.
const CAT_ACCENT = { all: '#22c4bf', quote: '#61d89e', contract: '#ff9351', rendering: '#9da9dd', layout: '#ffeb99', revisions: '#22c4bf', additional: '#61d89e' }
const CHIP_LABEL = { quote: 'Quote', contract: 'Contract', rendering: 'Render', layout: 'Layout', revisions: 'Revision', additional: 'Other' }
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
  const [dateFor, setDateFor] = useState(null) // quote id — change the signed date / contract number
  const [open, setOpen] = useState(() => new Set()) // folded groups the rep opened
  const [stamping, setStamping] = useState(null)
  const [query, setQuery] = useState('')
  const [sel, setSel] = useState(() => new Set()) // ticked files (bulk delete)
  const [bulkBusy, setBulkBusy] = useState(false)
  const inputRef = useRef(null)
  const uploadCat = useRef('quote')
  const attachFor = useRef(null) // "Attach the signed copy" of this quote id
  const selectCat = (key) => { setActive(key); setSel(new Set()) }
  const toggle = (k) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n })
  const tick = (p, on) => setSel((s) => { const n = new Set(s); if (on) n.add(p); else n.delete(p); return n })

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
  // lead's quotes (signed marks, the star) do: their own channel.
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
  // files a signed order points at: deleting one asks twice, bulk delete skips them
  const signedPaths = useMemo(() => {
    const m = new Map()
    for (const s of org.signed) {
      if (s.signedFile) m.set(s.signedFile.path, `the signed copy of ${quoteLine(s.quote)}`)
      if (s.stampedFile) m.set(s.stampedFile.path, `the DEPOSIT PAID copy of ${quoteLine(s.quote)}`)
    }
    return m
  }, [org])

  const allFiles = useMemo(() => SECTIONS.flatMap((s) => (filesByCat[s.key] || []).map((f) => ({ ...f, cat: s.key }))), [filesByCat])
  const counts = Object.fromEntries(SECTIONS.map(s => [s.key, (filesByCat[s.key] || []).length]))
  const total = allFiles.length

  // ── CURRENT: the signed agreement, the order as it stands, the latest revision order ──
  const curQuote = useMemo(() => currentOrderQuote(quotes), [quotes])
  const current = useMemo(() => {
    const rows = []
    for (const a of org.agreements) {
      const s = a.latest
      rows.push({ kind: 'signed', key: 'signed:' + s.quote.id, s, file: s.signedFile || s.stampedFile || null })
    }
    if (curQuote) {
      const file = curQuote.pdf_snapshot_url ? allFiles.find((f) => f.path === curQuote.pdf_snapshot_url) || null : null
      rows.push({ kind: 'quote', key: 'quote:' + curQuote.id, q: curQuote, file })
    }
    const revs = (filesByCat.revisions || [])
    if (revs.length) rows.push({ kind: 'revision', key: 'rev:' + revs[0].path, file: revs[0] })
    return rows
  }, [org, curQuote, allFiles, filesByCat.revisions])
  const shownPaths = useMemo(() => {
    const s = new Set()
    for (const r of current) { if (r.file) s.add(r.file.path); if (r.s) { if (r.s.signedFile) s.add(r.s.signedFile.path); if (r.s.stampedFile) s.add(r.s.stampedFile.path) } }
    return s
  }, [current])
  const history = useMemo(() => allFiles.filter((f) => !shownPaths.has(f.path)), [allFiles, shownPaths])
  const histOpen = open.has('history') || current.length === 0

  // ── search (any view): name, kind, date ──
  const q = query.trim().toLowerCase()
  const matches = (f) => !q || `${f.label} ${CHIP_LABEL[f.cat] || ''} ${fmtDate(f.createdAt)} ${f.cat}`.toLowerCase().includes(q)

  function triggerUpload(cat, attachTo = null) {
    uploadCat.current = cat
    attachFor.current = attachTo
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

  // delete one file + mirror it on the quote row that points at it (a quote PDF)
  async function deleteOne(path) {
    await deleteDoc(path)
    try {
      const { data: gone } = await supabase.from('quotes')
        .update({ deleted_at: new Date().toISOString(), deleted_by: user?.id ?? null })
        .eq('client_id', clientId).eq('pdf_snapshot_url', path)
        .select('id')
      // a deleted revision gives the order it replaced back its place (owner 10/19/26)
      for (const g of gone || []) { try { await restoreAfterRevisionDeleted(supabase, g.id) } catch (e) { console.warn('order not restored', e) } }
    } catch { /* the file is deleted regardless */ }
  }
  async function onDelete(path) {
    const linked = signedPaths.get(path)
    if (linked && !window.confirm(`This is ${linked}. Delete it anyway? The order stays marked signed.`)) return
    if (!window.confirm('Delete this file? This cannot be undone.')) return
    try { await deleteOne(path); setSel((s) => { const n = new Set(s); n.delete(path); return n }); await refresh() }
    catch (e) { setError(e.message) }
  }
  // tick the junk, delete it in one go — asked once; files a signed order points at are left alone
  async function deleteTicked() {
    const picked = [...sel].filter((p) => allFiles.some((f) => f.path === p))
    const skip = picked.filter((p) => signedPaths.has(p))
    const go = picked.filter((p) => !signedPaths.has(p))
    if (!go.length) { toast(skip.length ? 'Those files belong to a signed order — untick them or delete them one at a time.' : 'Nothing ticked.'); return }
    const msg = `Delete ${go.length} ${go.length === 1 ? 'file' : 'files'}? This cannot be undone.${skip.length ? ` (${skip.length} ticked ${skip.length === 1 ? 'file belongs' : 'files belong'} to a signed order and will be left alone.)` : ''}`
    if (!window.confirm(msg)) return
    setBulkBusy(true); setError('')
    let done = 0
    try {
      for (const p of go) { try { await deleteOne(p); done++ } catch (e) { console.warn('not deleted', p, e) } }
      toast(`${done} ${done === 1 ? 'file' : 'files'} deleted${done < go.length ? ` · ${go.length - done} could not be` : ''}`, done === go.length ? 'success' : undefined)
    } finally {
      setBulkBusy(false); setSel(new Set()); await refresh()
    }
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
    else items.push({ id: 'attach', label: 'Attach the signed copy (upload)…', onClick: () => triggerUpload('contract', q.id) })
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
    items.push({ id: 'date', label: s.confirmed ? 'Change the signed date / contract #…' : 'Set the date he signed…', onClick: () => setDateFor(q.id) })
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

  // one file row (the table's 4 columns); `more` = folded older copies of the same file; `pick` = a tick-box
  function fileRow({ f, cat, note = null, more = null, gkey = null, signed = false, sub = false, chip = null, pick = false }) {
    const acc = CAT_ACCENT[cat] || '#14A6A0'
    const canMark = cat === 'contract' && !signedPaths.has(f.path)
    return (
      <div key={f.path} className={`doc-row${sub ? ' doc-row-sub' : ''}`} style={accentVars(acc)}>
        <span className="doc-name" role="button" onClick={() => onView(f.path)} title={f.label}>
          {pick && <input type="checkbox" className="doc-sel" checked={sel.has(f.path)} onClick={(e) => e.stopPropagation()} onChange={(e) => tick(f.path, e.target.checked)} aria-label={`Tick ${f.label}`} />}
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
  // a list of files of one kind: same-named copies folded under the newest; tick-boxes
  const foldedRows = (files, cat, pick = true) => groupByLabel(files).flatMap((g) => {
    const k = `${cat}:${g.latest.label.toLowerCase()}`
    return [
      fileRow({ f: g.latest, cat, more: g.older.length, gkey: k, signed: signedPaths.has(g.latest.path), chip: chipOf(g.latest.path), pick }),
      ...(open.has(k) ? g.older.map((f) => fileRow({ f, cat, sub: true, signed: signedPaths.has(f.path), chip: chipOf(f.path), pick })) : []),
    ]
  })
  const bulkBar = () => (sel.size > 0 ? (
    <div className="dh-bulk">
      <span><b>{sel.size}</b> ticked</span>
      <span className="sp" />
      <button type="button" onClick={() => setSel(new Set())} disabled={bulkBusy}>Clear</button>
      <button type="button" className="del" onClick={deleteTicked} disabled={bulkBusy}>{bulkBusy ? 'Deleting…' : `Delete ${sel.size}`}</button>
    </div>
  ) : null)
  const listHead = <div className="doc-list-head"><span>File Name</span><span>Kind</span><span>Date</span><span className="r">Actions</span></div>

  // ── the Contracts chip: Signed / Not signed / Uploads to sort ──
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
          <div key={a.key} className="ctr-agr">
            <div className="ctr-agr-h">{a.agreement ? <>Agreement <b>{a.agreement}</b></> : <>Order <b>{quoteLine(a.entries[0].quote)}</b></>}</div>
            {a.entries.map((s) => {
              const latest = s === a.latest
              const gk = `contract:gen:${s.quote.id}`
              return (
                <div key={s.quote.id} className={`ctr-sig${latest ? ' now' : ''}`}>
                  <div className="ctr-sig-top">
                    <span className="ctr-sig-ic">{CHECK}</span>
                    <span className="ctr-sig-main">
                      <b>{s.role}</b>
                      <span className="ctr-sig-sub">{s.number && s.number !== s.quote.quote_number ? <>contract <b>{s.number}</b> · </> : null}#{s.quote.quote_number || '—'} · {s.confirmed
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
                      ? fileRow({ f: s.signedFile, cat: 'contract', signed: true, chip: 'Signed copy' })
                      : <div className="ctr-missing">No signed copy attached. <button type="button" onClick={() => triggerUpload('contract', s.quote.id)}>Attach it</button></div>}
                    {s.stampedFile && fileRow({ f: s.stampedFile, cat: 'contract', signed: true, chip: 'Deposit paid' })}
                    {stamping === s.quote.id && <div className="ctr-missing">Making the DEPOSIT PAID copy…</div>}
                    {s.generated.length > 0 && (
                      <button type="button" className="ctr-fold" onClick={() => toggle(gk)}>
                        {open.has(gk) ? 'Hide' : 'Show'} the {s.generated.length} {s.generated.length === 1 ? 'copy' : 'copies'} we generated for this number
                      </button>
                    )}
                    {open.has(gk) && s.generated.map((f) => fileRow({ f, cat: 'contract', sub: true, chip: 'Generated', pick: true }))}
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
                fileRow({ f: g.latest, cat: 'contract', note, more: g.older.length, gkey: k, pick: true }),
                ...(open.has(k) ? g.older.map((f) => fileRow({ f, cat: 'contract', sub: true, pick: true })) : []),
              ]
            })}
          </>
        )}

        {org.uploads.length > 0 && (
          <>
            <div className="ctr-h"><span className="ctr-h-dot warn" />Uploads to sort · tap ✓ if it is what the customer signed</div>
            {org.uploads.map((f) => fileRow({ f, cat: 'contract', pick: true }))}
          </>
        )}
        {bulkBar()}
      </div>
    )
  }

  // ── CURRENT rows ──
  function currentRow(r) {
    if (r.kind === 'signed') {
      const s = r.s
      const sub = [s.number ? `contract ${s.number}` : null, `#${s.quote.quote_number || '—'}`, s.confirmed ? null : 'date not set'].filter(Boolean).join(' · ')
      return (
        <div key={r.key} className={`dh-cur-row${s.confirmed ? ' ok' : ' warn'}`}>
          <span className="dh-cur-ic">{CHECK}</span>
          <span className="dh-cur-main">
            <b>Signed agreement · {s.role}{s.current ? '' : ' · replaced, not re-signed yet'}</b>
            <span>{s.confirmed ? <>signed <em>{fmtShortDate(s.signedOn)}</em> · </> : null}{sub}</span>
          </span>
          <span className="dh-cur-chip">{s.confirmed ? 'Signed' : 'Date?'}</span>
          <span className="dh-cur-acts">
            {r.file && <button type="button" onClick={() => onView(r.file.path)}>See it</button>}
            <button type="button" onClick={() => selectCat('contract')}>Contracts</button>
          </span>
        </div>
      )
    }
    if (r.kind === 'quote') {
      const qq = r.q
      const role = contractRoleOf(qq)
      return (
        <div key={r.key} className="dh-cur-row now">
          <span className="dh-cur-ic">{ICONS.quote}</span>
          <span className="dh-cur-main">
            <b>The order as it stands · #{qq.quote_number || '—'}{role !== 'Original contract' ? ` · ${role}` : ''}</b>
            <span>{[qq.building_size, quoteStatusLabel(qq.status), qq.quote_date ? fmtShortDate(qq.quote_date) : null, qq.total_amount != null ? '$' + Number(qq.total_amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : null].filter(Boolean).join(' · ')}</span>
          </span>
          <span className="dh-cur-chip">Current</span>
          <span className="dh-cur-acts">
            {r.file ? <button type="button" onClick={() => onView(r.file.path)}>Quote PDF</button> : <button type="button" onClick={() => selectCat('quote')}>Quotes</button>}
          </span>
        </div>
      )
    }
    return (
      <div key={r.key} className="dh-cur-row">
        <span className="dh-cur-ic">{ICONS.revisions}</span>
        <span className="dh-cur-main"><b>Latest revision order</b><span>{r.file.label} · {fmtDate(r.file.createdAt)}</span></span>
        <span className="dh-cur-chip" style={{ color: 'var(--fg-3)', border: '1px solid var(--line-2)' }}>Revision</span>
        <span className="dh-cur-acts"><button type="button" onClick={() => onView(r.file.path)}>See it</button></span>
      </div>
    )
  }

  // ── the All chip: search results, or CURRENT + HISTORY ──
  function allView() {
    if (q) {
      const hits = allFiles.filter(matches)
      if (!hits.length) return <div className="doc-empty">Nothing matches “{query.trim()}”.</div>
      return <>{listHead}{SECTIONS.flatMap((s) => { const fs = hits.filter((f) => f.cat === s.key); return fs.length ? [<div key={'h:' + s.key} className="dh-cat-h">{s.label} · {fs.length}</div>, ...foldedRows(fs, s.key)] : [] })}{bulkBar()}</>
    }
    if (!total && !org.signed.length) return <div className="doc-empty">No files on this lead yet.</div>
    return (
      <>
        <div className="dh-sec"><span className="ctr-h-dot ok" />Current <span className="n">· {current.length}</span></div>
        {current.length === 0
          ? <p className="dh-empty-cur">No signed agreement yet and no current quote. Build a quote, or upload the signed contract and mark it.</p>
          : <div className="dh-cur">{current.map(currentRow)}</div>}
        <button type="button" className="dh-sec btn" onClick={() => toggle('history')}>
          <span className="ctr-h-dot" />History <span className="n">· {history.length} {history.length === 1 ? 'file' : 'files'} · earlier quotes, contracts we generated, older copies</span>
          <span className={`chev${histOpen ? ' flip' : ''}`}>{CHEV}</span>
        </button>
        {histOpen && history.length > 0 && (
          <>
            {listHead}
            {SECTIONS.flatMap((s) => { const fs = history.filter((f) => f.cat === s.key); return fs.length ? [<div key={'h:' + s.key} className="dh-cat-h">{s.label} · {fs.length}</div>, ...foldedRows(fs, s.key)] : [] })}
            {bulkBar()}
          </>
        )}
        {histOpen && history.length === 0 && <div className="doc-empty">Nothing in history.</div>}
      </>
    )
  }
  // ── one kind of file ──
  function catView(cat) {
    const fs = (filesByCat[cat] || []).map((f) => ({ ...f, cat })).filter(matches)
    if (!fs.length) return <div className="doc-empty">{q ? `Nothing matches “${query.trim()}”.` : `No ${SECTIONS.find((s) => s.key === cat)?.label.toLowerCase() || 'files'} yet.`}</div>
    return <>{listHead}{foldedRows(fs, cat)}{bulkBar()}</>
  }

  const chips = [{ key: 'all', label: 'All', n: total }, ...SECTIONS.map((s) => ({ key: s.key, label: s.label, n: counts[s.key] }))]
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

      {/* counts · search · chips */}
      <div className="dh-stats">
        <div className="dh-stat ok"><b>{org.signed.length}</b><span>Signed</span></div>
        <div className="dh-stat now"><b>{current.length}</b><span>Current</span></div>
        <div className="dh-stat"><b>{history.length}</b><span>History</span></div>
      </div>
      <label className="dh-search">
        {SEARCH}
        <input type="search" value={query} placeholder="Search files by name, kind or date…" onChange={(e) => setQuery(e.target.value)} />
        {query && <button type="button" onClick={() => setQuery('')} aria-label="Clear the search">✕</button>}
      </label>
      <div className="dh-chips">
        {chips.map((c) => (
          <button key={c.key} type="button" className={`dh-chip${active === c.key ? ' on' : ''}`} onClick={() => selectCat(c.key)}>
            {c.label}<span className="n">{c.key === 'contract' && org.signed.length ? `${org.signed.length}✓ · ${c.n}` : c.n}</span>
          </button>
        ))}
      </div>

      {error && <div className="error-banner" style={{ margin: '0 24px 12px' }}>{error}</div>}

      {/* File list */}
      {loading ? (
        <div className="muted" style={{ padding: 24 }}>Loading…</div>
      ) : active === 'contract' && !q ? (
        <div className="doc-list">{contractsView()}</div>
      ) : active === 'all' ? (
        <div className="doc-list">{allView()}</div>
      ) : (
        <div className="doc-list">{catView(active)}</div>
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
