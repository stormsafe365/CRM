// RevisionModal: type out a Revision Order on screen — no handwriting.
// Opens from a quote card when a signed order changes (colors, doors, size…).
// The rep adds change rows (description / Add-Remove-Modify / price
// adjustment), the totals compute live from the quote's contract price, and
// Generate renders the FILLED-IN revision order (lib/revisionHtml) to PDF via
// the shared Electron print path, saves it to Document Hub › Revisions, and
// opens it ready to send for signature.

import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { uploadClientDocBlob } from '../lib/storage'
import { renderQuotePdf } from '../lib/builderSave'
import { buildRevisionHtml, makeRevisionOrderNumber } from '../lib/revisionHtml'
import { toast } from '../lib/uiFx'

const KINDS = ['Modify', 'Add', 'Remove']

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

export default function RevisionModal({ client, quote, onClose }) {
  const [revNo, setRevNo] = useState('1')
  const [date, setDate] = useState(isoToday())
  const [original, setOriginal] = useState(quote?.total_amount != null ? String(quote.total_amount) : '')
  const [rows, setRows] = useState([{ desc: '', kind: 'Modify', amount: '' }])
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState('')

  const setRow = (i, patch) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const addRow = () => setRows([...rows, { desc: '', kind: 'Modify', amount: '' }])
  const delRow = (i) => setRows(rows.length > 1 ? rows.filter((_, j) => j !== i) : rows)

  // Additions = positive adjustments; credits = negative ones. Revised price
  // tracks live so what the rep sees is exactly what prints.
  const totals = useMemo(() => {
    let additions = 0, credits = 0
    for (const r of rows) {
      const a = Number(r.amount)
      if (!r.desc.trim() || !isFinite(a)) continue
      if (a > 0) additions += a
      else credits += -a
    }
    const orig = Number(original) || 0
    return { additions, credits, revised: orig + additions - credits }
  }, [rows, original])

  async function generate() {
    const filled = rows.filter((r) => r.desc.trim())
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
      onClose()
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
          <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
            <input
              style={{ ...FIELD, flex: 2.4 }}
              placeholder={i === 0 ? 'e.g. Change wall color from Pewter Gray to Slate Blue' : 'Describe the change'}
              value={r.desc}
              autoFocus={i === 0}
              onChange={(e) => setRow(i, { desc: e.target.value })}
            />
            <select style={{ ...FIELD, flex: '0 0 96px', width: 96 }} value={r.kind} onChange={(e) => setRow(i, { kind: e.target.value })}>
              {KINDS.map((k) => <option key={k}>{k}</option>)}
            </select>
            <input
              style={{ ...FIELD, flex: '0 0 110px', width: 110 }}
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
        ))}
        <button onClick={addRow} style={{ border: '1px dashed var(--line, #294059)', background: 'none', color: 'var(--accent, #22d3c8)', fontSize: 12, padding: '7px 12px', borderRadius: 7, cursor: 'pointer' }}>+ Add another change</button>
        <p style={{ margin: '5px 0 0', fontSize: 11.5, color: 'var(--fg-3, #8598AC)' }}>
          Price column: positive = addition, negative = credit, blank or 0 = no-charge change.
        </p>

        <label style={LBL}>Note (shows on the order)</label>
        <input style={FIELD} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional — e.g. Requested by customer by phone 8/25" />

        {/* Live price summary — exactly what prints */}
        <div style={{ marginTop: 12, border: '1px solid var(--line, #294059)', borderRadius: 10, padding: '10px 14px', fontSize: 13 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', color: 'var(--fg-3, #8598AC)' }}><span>Original contract</span><b style={{ color: 'var(--fg, #e2e8f0)' }}>{fmt(Number(original) || 0)}</b></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', color: 'var(--fg-3, #8598AC)' }}><span>Additions (+)</span><b style={{ color: 'var(--fg, #e2e8f0)' }}>{fmt(totals.additions)}</b></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', color: 'var(--fg-3, #8598AC)' }}><span>Credits (−)</span><b style={{ color: 'var(--fg, #e2e8f0)' }}>{totals.credits ? '−' + fmt(totals.credits) : '$0.00'}</b></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0 1px', marginTop: 4, borderTop: '1px solid var(--line, #294059)', fontSize: 14.5 }}>
            <b>Revised contract price</b><b style={{ color: 'var(--accent, #22d3c8)' }}>{fmt(totals.revised)}</b>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button className="btn-secondary" disabled={!!busy} onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={!!busy} onClick={generate} style={{ fontWeight: 800 }}>
            {busy || 'Generate Revision Order'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
