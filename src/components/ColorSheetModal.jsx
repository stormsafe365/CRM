// ColorSheetModal: pick the client's final colors and generate the
// manufacturer color-selection sheet. Clients often order with colors TBD —
// when they choose, the rep opens this from the quote, picks roof / walls /
// trim (+ wainscot when the build has one) from the manufacturer's own
// palette, and Generate renders the sheet (lib/colorSheetHtml) to PDF via the
// shared Electron print path, saves it to the client's Document Hub
// (Additional), and opens it for immediate sending to the manufacturer.
// Prefills from the saved build's color fields when they were already set.

import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { uploadClientDocBlob } from '../lib/storage'
import { renderQuotePdf } from '../lib/builderSave'
import { buildColorSheetHtml, makeColorSheetNumber, matchSavedColor, paletteFor } from '../lib/colorSheetHtml'
import { toast } from '../lib/uiFx'

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

export default function ColorSheetModal({ client, quote, onClose }) {
  const { list, mfrName } = paletteFor(quote?.manufacturer)
  // Saved build fields (3D-builder quotes): cr/cw/ct/cwn hold the chosen hex
  // ('' or 'TBD' when the client hadn't picked yet); wain = wainscot on/off.
  const f = quote?.payload_json?.fields || {}
  const hasWainscot = f.wain === 'yes' || !!matchSavedColor(list, f.cwn)

  const [sel, setSel] = useState({
    roof: matchSavedColor(list, f.cr)?.n || '',
    walls: matchSavedColor(list, f.cw)?.n || '',
    trim: matchSavedColor(list, f.ct)?.n || '',
    wainscot: matchSavedColor(list, f.cwn)?.n || '',
  })
  const [note, setNote] = useState('')
  const [date, setDate] = useState(isoToday())
  const [busy, setBusy] = useState('')

  const byName = useMemo(() => Object.fromEntries(list.map((c) => [c.n, c])), [list])
  const surfaces = useMemo(() => ([
    ['roof', 'Roof Color', true],
    ['walls', 'Wall Color', true],
    ['trim', 'Trim Color', true],
    ['wainscot', hasWainscot ? 'Wainscot Color' : 'Wainscot Color (only if the build has wainscot)', hasWainscot],
  ]), [hasWainscot])

  async function generate() {
    const missing = surfaces.filter(([key, , req]) => req && !sel[key]).map(([, label]) => label.replace(' Color', ''))
    if (missing.length) { toast(`Pick the ${missing.join(', ')} color${missing.length > 1 ? 's' : ''} first.`); return }
    setBusy('Rendering…')
    try {
      const number = makeColorSheetNumber(quote)
      const html = buildColorSheetHtml({
        client,
        quote,
        sheet: {
          number,
          date,
          roof: byName[sel.roof],
          walls: byName[sel.walls],
          trim: byName[sel.trim],
          wainscot: sel.wainscot ? byName[sel.wainscot] : null,
          note: note.trim(),
        },
      })
      const blob = await renderQuotePdf(html)
      setBusy('Saving…')
      let saved = true
      try {
        await uploadClientDocBlob(client.id, 'additional', blob, `${number}.pdf`, 'application/pdf')
        window.dispatchEvent(new CustomEvent('ss:docs-updated', { detail: { clientId: client.id } }))
      } catch (e) { saved = false; console.warn('color sheet upload failed', e) }
      // Open the finished sheet right away so it can be sent to the manufacturer.
      try { window.open(URL.createObjectURL(blob), '_blank') } catch { /* ignore */ }
      toast(saved
        ? `Color sheet ${number} saved to ${client.name || 'lead'} · Documents › Additional`
        : 'Color sheet generated (opened in a new window) — but saving to Documents failed.',
      saved ? 'success' : undefined)
      setBusy('')
      onClose()
    } catch (e) {
      setBusy('')
      toast(e.message || 'Could not generate the color sheet.')
    }
  }

  const swatch = (name) => (
    <span aria-hidden style={{
      flex: 'none', width: 34, height: 34, borderRadius: 8,
      border: '1px solid var(--line, #294059)',
      background: byName[name]?.h || 'transparent',
      backgroundImage: byName[name] ? 'none' : 'repeating-linear-gradient(45deg, transparent 0 6px, rgba(133,152,172,.18) 6px 12px)',
    }} />
  )

  return createPortal(
    <div
      role="dialog" aria-modal="true" aria-label="Color Selection Sheet"
      style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(4,9,16,.62)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose() }}
    >
      <div style={{
        width: 'min(460px, calc(100vw - 32px))', maxHeight: 'calc(100vh - 64px)', overflow: 'auto',
        background: 'var(--card, #0D1929)', border: '1px solid var(--line, #294059)',
        borderRadius: 14, padding: 18, boxShadow: '0 18px 60px rgba(0,0,0,.5)',
      }}>
        <h2 style={{ margin: '2px 0 4px', fontSize: 17 }}>Color Selection Sheet</h2>
        <p style={{ margin: '0 0 6px', color: 'var(--fg-3, #8598AC)', fontSize: 13 }}>
          {client?.name || 'Client'}{quote?.quote_number ? ` · Quote #${quote.quote_number}` : ''}
          {mfrName ? ` · To: ${mfrName}` : ''}
        </p>
        <p style={{ margin: '0 0 2px', color: 'var(--fg-3, #8598AC)', fontSize: 12.5 }}>
          Final colors for manufacturing — the sheet saves to Documents and opens ready to send.
        </p>

        {surfaces.map(([key, label, req]) => (
          <div key={key}>
            <label style={LBL}>{label}{req ? ' *' : ''}</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {swatch(sel[key])}
              <select style={FIELD} value={sel[key]} onChange={(e) => setSel({ ...sel, [key]: e.target.value })}>
                <option value="">{req ? '— choose a color —' : 'Not applicable — leave off the sheet'}</option>
                {list.map((c) => <option key={c.n} value={c.n}>{c.n}{c.c ? ` (${c.c})` : ''}</option>)}
              </select>
            </div>
          </div>
        ))}

        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <label style={LBL}>Selection Date</label>
            <input style={FIELD} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>

        <label style={LBL}>Note (shows on the sheet)</label>
        <input style={FIELD} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional — e.g. Confirmed by phone with customer" />

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button className="btn-secondary" disabled={!!busy} onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={!!busy} onClick={generate} style={{ fontWeight: 800 }}>
            {busy || 'Generate Color Sheet'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
