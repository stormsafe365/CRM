// RevisionModal: type out a Revision Order on screen — no handwriting.
// Opens from a quote card when a signed order changes (colors, doors, size…).
// The rep adds change rows (description / Add-Remove-Modify / price
// adjustment), the totals compute live from the quote's contract price, and
// Generate renders the FILLED-IN revision order (lib/revisionHtml) to PDF via
// the shared Electron print path, saves it to Document Hub › Revisions, and
// opens it ready to send for signature.

import { useEffect, useMemo, useState } from 'react'
import { loadPriceEngine, rollupCatalog } from '../lib/revisionPricing'
import { createPortal } from 'react-dom'
import { uploadClientDocBlob } from '../lib/storage'
import { renderQuotePdf } from '../lib/builderSave'
import { buildRevisionHtml, makeRevisionOrderNumber } from '../lib/revisionHtml'
import { toast } from '../lib/uiFx'

// Structured change rows (owner request 9/21/26): a change is either a
// component added/removed on a specific wall, a building-size change, or a
// free-text modify. The printed description is composed from the pickers.
const CHANGE_TYPES = [
  { v: 'add', l: 'Add Component' },
  { v: 'remove', l: 'Remove Component' },
  { v: 'size', l: 'Building Size Change' },
  { v: 'other', l: 'Other / Modify' },
]
const COMPONENTS = ['Roll-Up Door', 'Walk-Through Door', 'Window', 'Framed Opening', 'Garage Door Opener', 'Chain Hoist', 'Brush Seal', 'Lean-To', 'Insulation', 'Other']
const WALLS = ['Front Gable End', 'Back Gable End', 'Left Eave Side', 'Right Eave Side', '—']

const emptyRow = () => ({ type: 'add', comp: 'Roll-Up Door', size: '', wall: 'Front Gable End', from: '', to: '', desc: '', amount: '', hoist: false, seal: false, opener: false })

// Compose the line that prints on the order from the structured fields.
function rowDesc(r) {
  if (r.type === 'size') {
    const f = r.from.trim(), t = r.to.trim()
    return f || t ? `Building Size Change — ${f || '?'} → ${t || '?'}${r.desc.trim() ? ` (${r.desc.trim()})` : ''}` : ''
  }
  if (r.type === 'other') return r.desc.trim()
  const comp = r.comp === 'Other' ? (r.desc.trim() || 'Component') : r.comp
  const size = r.size.trim() ? ` ${r.size.trim()}` : ''
  const wall = r.wall && r.wall !== '—' ? ` — ${r.wall}` : ''
  const addons = []
  if (r.hoistIncluded) addons.push('chain hoist included')
  else if (r.hoist) addons.push('chain hoist')
  if (r.seal) addons.push('brush seal')
  if (r.opener) addons.push('automatic opener')
  const withA = addons.length ? ` (with ${addons.join(', ')})` : ''
  const extra = r.comp !== 'Other' && r.desc.trim() ? ` (${r.desc.trim()})` : ''
  return `${comp}${size}${wall}${withA}${extra}`
}
const rowKind = (r) => (r.type === 'add' ? 'Add' : r.type === 'remove' ? 'Remove' : 'Modify')
const rowFilled = (r) => !!rowDesc(r)

const FIELD = {
  width: '100%', boxSizing: 'border-box',
  background: 'var(--inset, #0B1B32)', color: 'var(--fg, #e2e8f0)',
  border: '1px solid var(--line, #294059)', borderRadius: 8,
  padding: '9px 11px', fontSize: 13.5,
}
const LBL = { display: 'block', fontSize: 11.5, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--fg-3, #8598AC)', margin: '10px 0 4px' }

const isoToday = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const fmt = (n) => '$' + (Math.round(n * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function RevisionModal({ client, quote, onClose, onApplyToBuild }) {
  const [revNo, setRevNo] = useState('1')
  const [date, setDate] = useState(isoToday())
  const [original, setOriginal] = useState(quote?.total_amount != null ? String(quote.total_amount) : '')
  const [rows, setRows] = useState([emptyRow()])
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState('')
  // The quote carries its own discount % and tax % (builder field snapshot).
  // Reps naturally type LIST prices for changes ("$1,900 door"), but the
  // contract total is post-discount, post-tax — so by default the entered
  // amounts run through the same treatment. 'final' turns that off.
  const qf = quote?.payload_json?.fields || {}
  const discPct = Number(qf.disc) || 0
  const taxPct = Number(qf.tax) || 0
  const listFactor = (1 - discPct / 100) * (1 + taxPct / 100)
  const [amtMode, setAmtMode] = useState(discPct || taxPct ? 'list' : 'final')
  const origDeposit = Number(quote?.deposit_amount) || 0

  // Live engine pricing: load the actual quote-builder in a hidden iframe and
  // ask it for roll-up sizes + prices + add-on rates (single source of truth).
  const [cat, setCat] = useState(null)
  useEffect(() => {
    let dead = false
    loadPriceEngine(quote?.manufacturer)
      .then((pg) => { if (!dead) setCat(rollupCatalog(pg)) })
      .catch(() => { /* dropdowns fall back to manual entry */ })
    return () => { dead = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Selecting a size (or toggling add-ons) auto-fills the row's LIST price
  // straight from the engine: door + hoist (unless included) + seal + opener.
  function priceRow(next) {
    if (!cat || next.comp !== 'Roll-Up Door' || !next.size) return next
    const included = cat.hoistIncluded(next.size)
    let amt = cat.price(next.size) || 0
    if (!included && next.hoist) amt += cat.chain
    if (next.seal) amt += cat.sealFor(next.size)
    if (next.opener && cat.openerFor) amt += cat.openerFor(next.size)
    return { ...next, hoistIncluded: included, amount: amt ? String(amt) : next.amount }
  }
  const setRowPriced = (i, patch) => setRows(rows.map((r, j) => (j === i ? priceRow({ ...r, ...patch }) : r)))

  const setRow = (i, patch) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const addRow = () => setRows([...rows, emptyRow()])
  const delRow = (i) => setRows(rows.length > 1 ? rows.filter((_, j) => j !== i) : rows)

  // Additions = positive adjustments; credits = negative ones. Revised price
  // tracks live so what the rep sees is exactly what prints.
  const totals = useMemo(() => {
    let additions = 0, credits = 0
    const fac = amtMode === 'list' ? listFactor : 1
    for (const r of rows) {
      const a = Number(r.amount) * fac
      if (!rowFilled(r) || !isFinite(a)) continue
      if (a > 0) additions += a
      else credits += -a
    }
    const orig = Number(original) || 0
    const revised = orig + additions - credits
    const net = additions - credits
    // Deposit scales at the order's own deposit ratio; balance = revised − deposit.
    const depRatio = orig > 0 && origDeposit > 0 ? origDeposit / orig : 0
    const newDeposit = origDeposit ? origDeposit + net * depRatio : null
    const depDiff = newDeposit != null ? newDeposit - origDeposit : null
    const origBalance = orig - origDeposit
    const newBalance = newDeposit != null ? revised - newDeposit : null
    const balDiff = newBalance != null ? newBalance - origBalance : null
    return { additions, credits, revised, net, newDeposit, depDiff, newBalance, balDiff }
  }, [rows, original, amtMode, listFactor, origDeposit])

  async function generate(applyAfter) {
    const filled = rows.filter(rowFilled).map((r) => ({ desc: rowDesc(r), kind: rowKind(r), amount: r.amount }))
    if (!filled.length) { toast('Describe at least one change first.'); return }
    setBusy('Rendering…')
    try {
      const number = makeRevisionOrderNumber(quote)
      const html = buildRevisionHtml({
        client,
        quote,
        revision: {
          number,
          revNo: revNo.trim() || '1',
          date,
          rows: filled,
          original: Number(original) || 0,
          additions: totals.additions,
          credits: totals.credits,
          revised: totals.revised,
          origDeposit: origDeposit || null,
          newDeposit: totals.newDeposit,
          newBalance: totals.newBalance,
          note: note.trim(),
        },
      })
      const blob = await renderQuotePdf(html)
      setBusy('Saving…')
      let saved = true
      try {
        await uploadClientDocBlob(client.id, 'revisions', blob, `${number}.pdf`, 'application/pdf')
        window.dispatchEvent(new CustomEvent('ss:docs-updated', { detail: { clientId: client.id } }))
      } catch (e) { saved = false; console.warn('revision upload failed', e) }
      try { window.open(URL.createObjectURL(blob), '_blank') } catch { /* ignore */ }
      toast(saved
        ? `Revision order ${number} saved to ${client.name || 'lead'} · Documents › Revisions`
        : 'Revision order generated (opened in a new window) — but saving to Documents failed.',
      saved ? 'success' : undefined)
      setBusy('')
      if (applyAfter && onApplyToBuild) {
        // Hand the structured rows to the builder so the components land on the
        // actual building (rep drags exact placement, then Generate Contract).
        onApplyToBuild(rows.filter(rowFilled).map((r) => ({ ...r })))
      } else {
        onClose()
      }
    } catch (e) {
      setBusy('')
      toast(e.message || 'Could not generate the revision order.')
    }
  }

  return createPortal(
    <div
      role="dialog" aria-modal="true" aria-label="Revision Order"
      style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(4,9,16,.62)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose() }}
    >
      <div style={{
        width: 'min(560px, calc(100vw - 32px))', maxHeight: 'calc(100vh - 64px)', overflow: 'auto',
        background: 'var(--card, #0D1929)', border: '1px solid var(--line, #294059)',
        borderRadius: 14, padding: 18, boxShadow: '0 18px 60px rgba(0,0,0,.5)',
      }}>
        <h2 style={{ margin: '2px 0 4px', fontSize: 17 }}>Revision Order</h2>
        <p style={{ margin: '0 0 6px', color: 'var(--fg-3, #8598AC)', fontSize: 13 }}>
          {client?.name || 'Client'}{quote?.quote_number ? ` · Quote #${quote.quote_number}` : ''}
          {quote?.total_amount ? ` · Contract $${Number(quote.total_amount).toLocaleString()}` : ''}
        </p>
        <p style={{ margin: '0 0 2px', color: 'var(--fg-3, #8598AC)', fontSize: 12.5 }}>
          Type each change below — the finished, filled-in order saves to Documents › Revisions and opens ready to sign.
        </p>

        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: '0 0 90px' }}>
            <label style={LBL}>Revision #</label>
            <input style={FIELD} value={revNo} onChange={(e) => setRevNo(e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={LBL}>Date</label>
            <input style={FIELD} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={LBL}>Original Contract ($)</label>
            <input style={FIELD} type="number" step="0.01" value={original} onChange={(e) => setOriginal(e.target.value)} />
          </div>
        </div>

        <label style={LBL}>Changes</label>
        {rows.map((r, i) => (
          <div key={i} style={{ border: '1px solid var(--line, #294059)', borderRadius: 10, padding: '8px 10px', marginBottom: 8 }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <select style={{ ...FIELD, flex: '0 0 172px', width: 172 }} value={r.type} onChange={(e) => setRow(i, { type: e.target.value })}>
                {CHANGE_TYPES.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
              </select>
              {(r.type === 'add' || r.type === 'remove') && (
                <>
                  <select style={{ ...FIELD, flex: 1.2 }} value={r.comp} onChange={(e) => setRowPriced(i, { comp: e.target.value })}>
                    {COMPONENTS.map((c) => <option key={c}>{c}</option>)}
                  </select>
                  {r.comp === 'Roll-Up Door' && cat && cat.sizes.length ? (
                    <select style={{ ...FIELD, flex: '0 0 92px', width: 92 }} value={r.size} title="Size — price fills in from the quoting engine" onChange={(e) => setRowPriced(i, { size: e.target.value })}>
                      <option value="">Size…</option>
                      {cat.sizes.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  ) : (
                    <input style={{ ...FIELD, flex: '0 0 78px', width: 78 }} placeholder="Size" title="e.g. 12x12" value={r.size} onChange={(e) => setRow(i, { size: e.target.value })} />
                  )}
                  <select style={{ ...FIELD, flex: 1.1 }} value={r.wall} title="Which wall" onChange={(e) => setRow(i, { wall: e.target.value })}>
                    {WALLS.map((wl) => <option key={wl}>{wl}</option>)}
                  </select>
                </>
              )}
              {r.type === 'size' && (
                <>
                  <input style={{ ...FIELD, flex: 1 }} placeholder="From — e.g. 30×50×12" value={r.from} onChange={(e) => setRow(i, { from: e.target.value })} />
                  <span style={{ color: 'var(--fg-3, #8598AC)', flex: 'none' }}>→</span>
                  <input style={{ ...FIELD, flex: 1 }} placeholder="To — e.g. 30×60×12" value={r.to} onChange={(e) => setRow(i, { to: e.target.value })} />
                </>
              )}
              {r.type === 'other' && (
                <input
                  style={{ ...FIELD, flex: 2.4 }}
                  placeholder="Describe the change — e.g. wall color Pewter Gray → Slate Blue"
                  value={r.desc}
                  onChange={(e) => setRow(i, { desc: e.target.value })}
                />
              )}
              <input
                style={{ ...FIELD, flex: '0 0 100px', width: 100 }}
                type="number" step="0.01" placeholder="+/− $"
                title="Positive = addition, negative = credit, blank/0 = no charge"
                value={r.amount}
                onChange={(e) => setRow(i, { amount: e.target.value })}
              />
              <button
                onClick={() => delRow(i)} title="Remove row" disabled={rows.length === 1}
                style={{ border: '1px solid var(--line, #294059)', background: 'none', color: 'var(--fg-3, #8598AC)', width: 26, height: 26, borderRadius: 6, cursor: rows.length === 1 ? 'default' : 'pointer', opacity: rows.length === 1 ? 0.4 : 1, flex: 'none', padding: 0 }}
              >×</button>
            </div>
            {r.type === 'add' && r.comp === 'Roll-Up Door' && cat && r.size && (
              <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginTop: 7, fontSize: 12.5, color: 'var(--fg, #e2e8f0)', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, color: 'var(--fg-3, #8598AC)', fontWeight: 700, letterSpacing: '.04em' }}>ADD-ONS:</span>
                {cat.hoistIncluded(r.size) ? (
                  <span style={{ color: 'var(--fg-3, #8598AC)' }}>✓ Chain hoist included</span>
                ) : (
                  <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
                    <input type="checkbox" checked={r.hoist} onChange={(e) => setRowPriced(i, { hoist: e.target.checked })} />
                    Chain Hoist (+{fmt(cat.chain)})
                  </label>
                )}
                <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
                  <input type="checkbox" checked={r.seal} onChange={(e) => setRowPriced(i, { seal: e.target.checked })} />
                  Brush Seal (+{fmt(cat.sealFor(r.size))})
                </label>
                {cat.openerFor && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
                    <input type="checkbox" checked={r.opener} onChange={(e) => setRowPriced(i, { opener: e.target.checked })} />
                    Auto Opener (+{fmt(cat.openerFor(r.size))})
                  </label>
                )}
              </div>
            )}
            {(r.type === 'add' || r.type === 'remove') && (
              <input
                style={{ ...FIELD, marginTop: 6, fontSize: 12.5, padding: '7px 10px' }}
                placeholder="Optional detail — e.g. hi-wind rated"
                value={r.desc}
                onChange={(e) => setRow(i, { desc: e.target.value })}
              />
            )}
            {rowFilled(r) && (
              <div style={{ marginTop: 6, fontSize: 11.5, color: 'var(--accent, #22d3c8)' }}>
                Prints as: <b>{rowKind(r)}</b> — {rowDesc(r)}
              </div>
            )}
          </div>
        ))}
        <button onClick={addRow} style={{ border: '1px dashed var(--line, #294059)', background: 'none', color: 'var(--accent, #22d3c8)', fontSize: 12, padding: '7px 12px', borderRadius: 7, cursor: 'pointer' }}>+ Add another change</button>
        <p style={{ margin: '5px 0 0', fontSize: 11.5, color: 'var(--fg-3, #8598AC)' }}>
          Price column: positive = addition, negative = credit, blank or 0 = no-charge change.
        </p>
        {(discPct > 0 || taxPct > 0) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
            <select style={{ ...FIELD, width: 'auto', flex: 'none', fontSize: 12.5, padding: '6px 9px' }} value={amtMode} onChange={(e) => setAmtMode(e.target.value)}>
              <option value="list">Amounts are list prices — apply the order's {discPct ? `${discPct}% discount` : ''}{discPct && taxPct ? ' + ' : ''}{taxPct ? `${taxPct}% tax` : ''}</option>
              <option value="final">Amounts are final — use as entered</option>
            </select>
            {amtMode === 'list' && <span style={{ fontSize: 11.5, color: 'var(--fg-3, #8598AC)' }}>×{listFactor.toFixed(3)} applied</span>}
          </div>
        )}

        <label style={LBL}>Note (shows on the order)</label>
        <input style={FIELD} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional — e.g. Requested by customer by phone 8/25" />

        {/* Live price summary — exactly what prints */}
        <div style={{ marginTop: 12, border: '1px solid var(--line, #294059)', borderRadius: 10, padding: '10px 14px', fontSize: 13 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', color: 'var(--fg-3, #8598AC)' }}><span>Original contract</span><b style={{ color: 'var(--fg, #e2e8f0)' }}>{fmt(Number(original) || 0)}</b></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', color: 'var(--fg-3, #8598AC)' }}><span>Additions (+)</span><b style={{ color: 'var(--fg, #e2e8f0)' }}>{fmt(totals.additions)}</b></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', color: 'var(--fg-3, #8598AC)' }}><span>Credits (−)</span><b style={{ color: 'var(--fg, #e2e8f0)' }}>{totals.credits ? '−' + fmt(totals.credits) : '$0.00'}</b></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0 1px', marginTop: 4, borderTop: '1px solid var(--line, #294059)', fontSize: 14.5 }}>
            <b>Revised contract price</b><b style={{ color: 'var(--accent, #22d3c8)' }}>{fmt(totals.revised)}{totals.net ? <span style={{ fontSize: 11.5, marginLeft: 6, color: 'var(--fg-3, #8598AC)' }}>({totals.net > 0 ? '+' : '−'}{fmt(Math.abs(totals.net))})</span> : null}</b>
          </div>
          {totals.newDeposit != null && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0 3px', marginTop: 6, borderTop: '1px dashed var(--line, #294059)', color: 'var(--fg-3, #8598AC)' }}>
                <span>Revised deposit</span>
                <b style={{ color: 'var(--fg, #e2e8f0)' }}>{fmt(totals.newDeposit)}<span style={{ fontSize: 11.5, marginLeft: 6, color: 'var(--accent, #22d3c8)' }}>({totals.depDiff >= 0 ? '+' : '−'}{fmt(Math.abs(totals.depDiff))} due)</span></b>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', color: 'var(--fg-3, #8598AC)' }}>
                <span>Revised balance at scheduling</span>
                <b style={{ color: 'var(--fg, #e2e8f0)' }}>{fmt(totals.newBalance)}<span style={{ fontSize: 11.5, marginLeft: 6, color: 'var(--fg-3, #8598AC)' }}>({totals.balDiff >= 0 ? '+' : '−'}{fmt(Math.abs(totals.balDiff))})</span></b>
              </div>
            </>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16, flexWrap: 'wrap' }}>
          <button className="btn-secondary" disabled={!!busy} onClick={onClose}>Cancel</button>
          <button className="btn-secondary" disabled={!!busy} onClick={() => generate(false)}>
            {busy || 'Revision Order only'}
          </button>
          {onApplyToBuild && (
            <button className="btn-primary" disabled={!!busy} onClick={() => generate(true)} style={{ fontWeight: 800 }} title="Saves the Revision Order, then opens the builder with these changes applied so you place them and print the revised contract with renderings + spacing sheet">
              {busy || 'Generate + Apply to Building →'}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
