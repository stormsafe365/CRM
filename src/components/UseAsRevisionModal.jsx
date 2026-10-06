// UseAsRevisionModal — "Use as revision" (owner 10/6/26): the rep duplicated a
// signed quote and already made the changes in the copy. This turns the copy
// into the revised contract for the signed order.
//   Step 1  Which signed quote does this revise?  (the lead's other quotes,
//           signed / ordered first)
//   Step 2  Automatic — compare the two quotes   |   Manual — type the changes
//   Auto    the price engine lists every change and prices ONLY the changes
//           (lib/revisionEngine); unchanged items stay at the signed price. The
//           rep can untick a line (left off, not charged); a change the engine
//           can't price needs a typed amount — nothing is guessed.
// "Create revised contract" hands the result to BuildQuoteModal, which holds
// the builder at the revised price and writes the Revision Order + Revised
// Contract. Manual hands the chosen quote back for the typed Revision Order.

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'
import { quoteStatusColor, quoteStatusLabel } from '../lib/constants'
import { analyzeRevision, analyzeSignedOnly } from '../lib/revisionEngine'
import { r2, revisionCandidates, revisionMoney } from '../lib/revisionDiff'
import { REVISION_ADJ_LABEL, fmtMoney, isSold } from '../lib/priceLockCrm'
import { nextRevNo } from '../lib/contractDocs'
import { ContractSentTag } from './ReplacedBadge'

const FIELD = {
  width: '100%', boxSizing: 'border-box', background: 'var(--inset, #0B1B32)', color: 'var(--fg, #e2e8f0)',
  border: '1px solid var(--line, #294059)', borderRadius: 8, padding: '8px 10px', fontSize: 13.5,
}
const LBL = { display: 'block', fontSize: 11.5, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--fg-3, #8598AC)', margin: '10px 0 4px' }
const MUTED = { color: 'var(--fg-3, #8598AC)' }
const isoToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const fmtDate = (s) => { if (!s) return '—'; const [y, m, d] = String(s).slice(0, 10).split('-'); return `${m}/${d}/${y}` }
const KIND = { add: 'Add', remove: 'Remove', change: 'Change', move: 'Moved', field: 'Change', drift: 'Rule', residual: 'Other' }
const KIND_COLOR = { add: '#22d3c8', remove: '#f87171', move: '#94a3b8', drift: '#f0883e', residual: '#f0883e' }

export default function UseAsRevisionModal({ client, currentQuote, getProgramWindow, onClose, onManual, onFinish }) {
  const [step, setStep] = useState('pick') // pick | how | auto
  const [quotes, setQuotes] = useState(null)
  const [loadErr, setLoadErr] = useState('')
  const [origId, setOrigId] = useState('')
  const [busy, setBusy] = useState('')
  const [result, setResult] = useState(null)   // analyzeRevision()
  const [rows, setRows] = useState([])         // result lines + {include, typed}
  const [revNo, setRevNo] = useState('1')
  const [date, setDate] = useState(isoToday())
  const [note, setNote] = useState('')
  const [howErr, setHowErr] = useState([])

  useEffect(() => {
    let dead = false
    ;(async () => {
      try {
        const { data, error } = await supabase.from('quotes').select('*').eq('client_id', client.id)
        if (dead) return
        if (error) { setLoadErr(error.message); setQuotes([]); return }
        const list = revisionCandidates(data || [], currentQuote?.id)
        setQuotes(list)
        const from = currentQuote?.payload_json?.duplicatedFrom?.id
        const pre = list.find((c) => c.q.id === from && c.builder) || list.find((c) => c.sold && c.builder) || list.find((c) => c.builder)
        if (pre) setOrigId(pre.q.id)
      } catch (e) { if (!dead) { setLoadErr(e.message || String(e)); setQuotes([]) } }
    })()
    return () => { dead = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const original = useMemo(() => (quotes || []).find((c) => c.q.id === origId)?.q || null, [quotes, origId])
  useEffect(() => {
    // Revision # follows the order's earlier revisions — a revision of a revision counts on (rep can change it).
    setRevNo(original ? nextRevNo(original) : '1')
  }, [original])

  async function runAuto() {
    const pg = getProgramWindow()
    if (!pg || !original) return
    setStep('auto'); setResult(null); setBusy('Comparing the two quotes…')
    try {
      const res = await analyzeRevision({ original, livePg: pg, onProgress: setBusy })
      setResult(res)
      setRows((res.lines || []).map((l) => ({ ...l, include: true, typed: '' })))
    } catch (e) {
      setResult({ blockers: [`The comparison failed: ${e.message || e}`], lines: [] })
    }
    setBusy('')
  }

  async function runManual() {
    const pg = getProgramWindow()
    if (!pg || !original) return
    setBusy('Reading the signed quote…'); setHowErr([])
    try {
      const res = await analyzeSignedOnly({ original, livePg: pg, onProgress: setBusy })
      setBusy('')
      if (res.blockers && res.blockers.length) { setHowErr(res.blockers); return }
      onManual(original, res)
    } catch (e) { setBusy(''); setHowErr([e.message || String(e)]) }
  }

  // Live money preview — the same revisionMoney() the documents use.
  const lines = rows.map((r) => ({ ...r, amount: r.unpriced ? (r.typed === '' ? null : Number(r.typed)) : r.amount }))
  const missing = lines.filter((l) => l.include && l.unpriced && !Number.isFinite(Number(l.amount === null ? NaN : l.amount)))
  let money = null, moneyErr = ''
  if (result && result.signed && result.signed.ok && result.forward && !missing.length) {
    try { money = revisionMoney({ signed: result.signed, lines, forward: result.forward }) } catch (e) { moneyErr = e.message }
  }
  const setRow = (i, patch) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  // An original that was never signed: its saved total is the starting price, and no deposit was paid on it.
  const origSigned = isSold(original?.status)

  function finish() {
    if (!money || !original) return
    onFinish({
      original, mode: 'auto', lines, money, signed: result.signed, terms: result.terms, forward: result.forward,
      origDims: result.origDims, aewChanged: result.aewChanged, baseToday: result.baseToday, revNo: revNo.trim() || '1', date, note: note.trim(),
    })
  }

  const head = (
    <>
      <h2 style={{ margin: '2px 0 4px', fontSize: 17 }}>Use as revision</h2>
      <p style={{ margin: '0 0 8px', ...MUTED, fontSize: 13 }}>
        {client?.name || 'Client'}{currentQuote?.quote_number ? ` · this quote #${currentQuote.quote_number}` : ''} — the changes are already made in this quote.
      </p>
    </>
  )

  let body = null
  if (step === 'pick') {
    body = (
      <>
        <label style={LBL}>Which quote does this revise? <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}>(signed / ordered first, then contract sent)</span></label>
        {quotes == null && <div style={{ ...MUTED, fontSize: 13, padding: '8px 0' }}>Loading the lead’s quotes…</div>}
        {loadErr && <div style={{ color: 'var(--danger, #f87171)', fontSize: 13 }}>{loadErr}</div>}
        {quotes && !quotes.length && !loadErr && <div style={{ ...MUTED, fontSize: 13, padding: '8px 0' }}>This lead has no other quotes.</div>}
        <div role="radiogroup" aria-label="Signed quote" style={{ display: 'grid', gap: 6, maxHeight: 320, overflow: 'auto' }}>
          {(quotes || []).map(({ q, sold, builder, replaced }) => {
            const c = quoteStatusColor(q.status)
            const on = q.id === origId
            return (
              <label key={q.id} style={{ display: 'flex', alignItems: 'center', gap: 10, border: `1px solid ${on ? 'var(--accent, #22d3c8)' : 'var(--line, #294059)'}`, background: on ? 'rgba(34,211,200,.06)' : 'transparent', borderRadius: 10, padding: '9px 11px', cursor: builder ? 'pointer' : 'not-allowed', opacity: builder ? 1 : 0.55 }}>
                <input type="radio" name="uar-orig" checked={on} disabled={!builder} onChange={() => setOrigId(q.id)} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontWeight: 700 }}>#{q.quote_number || '—'}</span>
                  <span style={{ ...MUTED, marginLeft: 8, fontSize: 12.5 }}>{fmtDate(q.quote_date)}{q.building_size ? ` · ${q.building_size}` : ''}</span>
                  <ContractSentTag quote={q} />
                  {!builder && <span style={{ ...MUTED, display: 'block', fontSize: 11.5 }}>Added manually — no build to compare with</span>}
                  {currentQuote?.payload_json?.duplicatedFrom?.id === q.id && <span style={{ display: 'block', fontSize: 11.5, color: 'var(--accent, #22d3c8)' }}>This quote was duplicated from it</span>}
                </span>
                <span className="status-pill" style={{ background: c.bg, color: c.fg }}>{quoteStatusLabel(q.status)}</span>
                <b style={{ minWidth: 92, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{q.total_amount != null ? fmtMoney(q.total_amount) : '—'}</b>
                {!sold && !replaced && <span title="Not signed / ordered yet" style={{ color: '#f0883e', fontSize: 11 }}>unsigned</span>}{replaced && <span style={{ color: 'var(--fg-3, #8598AC)', fontSize: 11 }}>already replaced</span>}
              </label>
            )
          })}
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={!original} onClick={() => { setHowErr([]); setStep('how') }} style={{ fontWeight: 800 }}>Next →</button>
        </div>
      </>
    )
  } else if (step === 'how') {
    const card = { textAlign: 'left', border: '1px solid var(--line, #294059)', borderRadius: 12, padding: '13px 14px', background: 'var(--inset, #0B1B32)', color: 'var(--fg, #e2e8f0)', cursor: busy ? 'default' : 'pointer', width: '100%' }
    body = (
      <>
        <p style={{ margin: '0 0 10px', fontSize: 13 }}>
          {origSigned
            ? <>Revising <b>#{original?.quote_number}</b> — signed at <b>{original?.total_amount != null ? fmtMoney(original.total_amount) : '—'}</b>. Everything that didn’t change stays at the signed price; only the changes are priced (today’s prices).</>
            : <>Revising <b>#{original?.quote_number}</b> — <b>Original quote (not signed yet)</b> — its saved total <b>{original?.total_amount != null ? fmtMoney(original.total_amount) : '—'}</b> is the starting price. Everything that didn’t change stays at that price; only the changes are priced (today’s prices).</>}
        </p>
        <div style={{ display: 'grid', gap: 10 }}>
          <button type="button" style={card} disabled={!!busy} onClick={runAuto}>
            <div style={{ fontWeight: 800, fontSize: 14.5 }}>Automatic — compare the two quotes</div>
            <div style={{ ...MUTED, fontSize: 12.5, marginTop: 3 }}>The price engine lists what changed (added, removed, changed, moved) and prices each change. Untick anything you don’t want on the revision.</div>
          </button>
          <button type="button" style={card} disabled={!!busy} onClick={runManual}>
            <div style={{ fontWeight: 800, fontSize: 14.5 }}>Manual — type the changes</div>
            <div style={{ ...MUTED, fontSize: 12.5, marginTop: 3 }}>The Revision Order form, filled in with the {origSigned ? 'signed quote' : 'original quote'}. You type each change and its price.</div>
          </button>
        </div>
        {busy && <div style={{ ...MUTED, fontSize: 12.5, marginTop: 10 }}>{busy}</div>}
        {howErr.map((t, i) => <div key={i} style={{ color: 'var(--danger, #f87171)', fontSize: 12.5, marginTop: 8 }}>{t}</div>)}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', marginTop: 16 }}>
          <button className="btn-secondary" disabled={!!busy} onClick={() => setStep('pick')}>← Back</button>
          <button className="btn-secondary" disabled={!!busy} onClick={onClose}>Cancel</button>
        </div>
      </>
    )
  } else {
    const blockers = result?.blockers || []
    body = (
      <>
        <p style={{ margin: '0 0 6px', fontSize: 13 }}>
          Revising <b>#{original?.quote_number}</b> with this quote’s build.
        </p>
        {busy && <div style={{ ...MUTED, fontSize: 13, padding: '14px 0' }}>{busy}</div>}
        {!busy && blockers.length > 0 && (
          <div role="alert" style={{ border: '1px solid rgba(248,113,113,.5)', background: 'rgba(248,113,113,.07)', borderRadius: 10, padding: '10px 12px', fontSize: 13 }}>
            <b>The automatic comparison can’t be used:</b>
            <ul style={{ margin: '6px 0 0 18px', padding: 0 }}>{blockers.map((b, i) => <li key={i}>{b}</li>)}</ul>
            {!result.termsBlocked && <button className="btn-secondary" style={{ marginTop: 10 }} onClick={() => { setStep('how'); runManual() }}>Type the changes instead</button>}
          </div>
        )}
        {!busy && result && !blockers.length && (
          <>
            {(result.signed?.notes || []).map((n, i) => <div key={i} style={{ color: '#f0883e', fontSize: 12.5, margin: '4px 0' }}>{n}</div>)}
            <label style={LBL}>Changes found ({rows.length})</label>
            {!rows.length && <div style={{ ...MUTED, fontSize: 13 }}>No differences — the revised contract will be at the {origSigned ? 'signed price' : 'original quote’s saved total'}.</div>}
            <div style={{ display: 'grid', gap: 6 }}>
              {rows.map((r, i) => (
                <div key={r.id} style={{ border: `1px solid ${r.unpriced && r.include ? 'rgba(240,136,62,.6)' : 'var(--line, #294059)'}`, borderRadius: 10, padding: '8px 10px', opacity: r.include ? 1 : 0.55 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                    <input type="checkbox" aria-label={`Include: ${r.desc}`} checked={r.include} onChange={(e) => setRow(i, { include: e.target.checked })} />
                    <span style={{ flex: 'none', fontSize: 10, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', border: `1px solid ${KIND_COLOR[r.kind] || 'var(--line, #294059)'}`, color: KIND_COLOR[r.kind] || 'var(--fg-3, #8598AC)', borderRadius: 99, padding: '1px 8px' }}>{KIND[r.kind] || 'Change'}</span>
                    <span style={{ flex: 1, fontSize: 13, minWidth: 0 }}>{r.desc}</span>
                    {r.unpriced ? (
                      <input style={{ ...FIELD, width: 112, flex: 'none', textAlign: 'right' }} type="number" step="0.01" placeholder="Amount $" aria-label={`Amount for ${r.desc}`} value={r.typed} disabled={!r.include} onChange={(e) => setRow(i, { typed: e.target.value })} />
                    ) : (
                      <b style={{ flex: 'none', minWidth: 96, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: r.amount > 0 ? 'var(--fg, #e2e8f0)' : r.amount < 0 ? 'var(--success, #34d399)' : 'var(--fg-3, #8598AC)' }}>
                        {r.amount ? (r.amount > 0 ? '+' : '') + fmtMoney(r.amount) : '$0.00'}
                      </b>
                    )}
                  </div>
                  {r.unpriced && r.include && <div style={{ fontSize: 11.5, color: '#f0883e', marginTop: 4, paddingLeft: 26 }}>{r.reason}. Type the amount (list price, before discount / tax; 0 = no charge){Number.isFinite(r.engineDelta) ? ` — the price engine’s difference was ${fmtMoney(r.engineDelta)}` : ''}.</div>}
                  {!r.include && <div style={{ ...MUTED, fontSize: 11.5, marginTop: 4, paddingLeft: 26 }}>Left off the revision — not charged.</div>}
                </div>
              ))}
            </div>
            <p style={{ ...MUTED, fontSize: 11.5, margin: '6px 0 0' }}>Amounts are list prices (before the order’s discount and tax) from the price engine at today’s prices. The order’s discount and tax are applied once, on the adjustment line.</p>
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: '0 0 90px' }}><label style={LBL}>Revision #</label><input style={FIELD} value={revNo} onChange={(e) => setRevNo(e.target.value)} /></div>
              <div style={{ flex: 1 }}><label style={LBL}>Date</label><input style={FIELD} type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
            </div>
            <label style={LBL}>Note (shows on the order)</label>
            <input style={FIELD} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional — e.g. Requested by customer by phone 10/6" />
            <div style={{ marginTop: 12, border: '1px solid var(--line, #294059)', borderRadius: 10, padding: '10px 14px', fontSize: 13 }} aria-live="polite">
              {missing.length > 0 && <div style={{ color: '#f0883e' }}>Type an amount for {missing.length} line{missing.length === 1 ? '' : 's'} (or untick {missing.length === 1 ? 'it' : 'them'}) to see the revised totals.</div>}
              {moneyErr && <div style={{ color: 'var(--danger, #f87171)' }}>{moneyErr}</div>}
              {money && (
                <>
                  <Row l={origSigned ? 'Original contract (signed)' : 'Original quote (not signed yet)'} v={fmtMoney(result.signed.total)} />
                  <Row l="Changes (list prices)" v={(money.changesSub >= 0 ? '+' : '') + fmtMoney(money.changesSub)} />
                  {money.adjustment ? <Row l={REVISION_ADJ_LABEL} v={(money.adjustment > 0 ? '+' : '') + fmtMoney(money.adjustment)} /> : null}
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0 1px', marginTop: 4, borderTop: '1px solid var(--line, #294059)', fontSize: 14.5 }}>
                    <b>Revised contract price</b><b style={{ color: 'var(--accent, #22d3c8)' }}>{fmtMoney(money.total)} <span style={{ fontSize: 11.5, ...MUTED }}>({money.net >= 0 ? '+' : ''}{fmtMoney(money.net)})</span></b>
                  </div>
                  <div style={{ borderTop: '1px dashed var(--line, #294059)', marginTop: 6, paddingTop: 4 }}>
                    {origSigned
                      ? <><Row l="Deposit already paid" v={fmtMoney(result.signed.deposit)} />
                        <Row l="Additional deposit due" v={fmtMoney(Math.max(0, r2(money.deposit - result.signed.deposit)))} /></>
                      : <Row l="Deposit due (nothing paid yet)" v={fmtMoney(money.deposit)} />}
                    <Row l="New balance (due at scheduling)" v={fmtMoney(money.balance)} />
                  </div>
                </>
              )}
            </div>
          </>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', marginTop: 16, flexWrap: 'wrap' }}>
          <button className="btn-secondary" disabled={!!busy} onClick={() => setStep('how')}>← Back</button>
          <span style={{ display: 'flex', gap: 8 }}>
            <button className="btn-secondary" disabled={!!busy} onClick={onClose}>Cancel</button>
            {result && !blockers.length && (
              <button className="btn-primary" disabled={!!busy || !money} onClick={finish} style={{ fontWeight: 800 }} title="Holds this quote at the revised price, saves the Revision Order, marks the signed quote as replaced and generates the Revised Contract">
                Create revised contract →
              </button>
            )}
          </span>
        </div>
      </>
    )
  }

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="Use as revision"
      style={{ position: 'fixed', inset: 0, zIndex: 1250, background: 'rgba(4,9,16,.62)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose() }}>
      <div style={{ width: 'min(640px, calc(100vw - 32px))', maxHeight: 'calc(100vh - 64px)', overflow: 'auto', background: 'var(--card, #0D1929)', border: '1px solid var(--line, #294059)', borderRadius: 14, padding: 18, boxShadow: '0 18px 60px rgba(0,0,0,.5)' }}>
        {head}
        {body}
      </div>
    </div>,
    document.body,
  )
}

function Row({ l, v }) {
  return <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '3px 0', color: 'var(--fg-3, #8598AC)' }}><span>{l}</span><b style={{ color: 'var(--fg, #e2e8f0)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{v}</b></div>
}
