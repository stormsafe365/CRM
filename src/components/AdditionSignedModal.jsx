// AdditionSignedModal: mark an ADDITION ORDER signed (Doc Hub › Contracts › Addition orders) - the day the customer
// signed it and, when one was uploaded, the signed copy. Kept on the quote the addition was made from
// (payload_json.additions[].signed = { on, filePath, at }). The building's own signed mark is never touched.
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'
import { toast } from '../lib/uiFx'
import { cleanDay, localDay } from '../lib/contractDocs'
import { patchAddition, saveAdditionPayload } from '../lib/additionOrder'

const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])) // toast() renders HTML
const FIELD = {
  width: '100%', boxSizing: 'border-box', background: 'var(--inset, #0B1B32)', color: 'var(--fg, #e2e8f0)',
  border: '1px solid var(--line, #294059)', borderRadius: 8, padding: '9px 11px', fontSize: 13.5,
}

/** entry = { quote, add } (lib/contractDocs organizeContracts().additions); file = { path, label } just uploaded, or null */
export default function AdditionSignedModal({ entry, file = null, onClose, onDone }) {
  const prev = entry.add.signed || null
  const [day, setDay] = useState(cleanDay(prev && prev.on) || localDay())
  const [busy, setBusy] = useState(false)
  async function save() {
    const on = cleanDay(day)
    if (!on) { toast('Pick the day he signed.'); return }
    if (on > localDay()) { toast('That day is in the future.'); return }
    setBusy(true)
    try {
      const signed = { on, filePath: (file && file.path) || (prev && prev.filePath) || null, at: new Date().toISOString() }
      await saveAdditionPayload(supabase, entry.quote.id, (p) => patchAddition(p, entry.add.number, { signed }))
      toast(`Addition order ${escHtml(entry.add.number)} marked signed`, 'success')
      onDone && onDone()
    } catch (e) { toast(escHtml(e.message || 'Could not save.')) } finally { setBusy(false) }
  }
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="Addition order signed" className="msign-scrim"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose() }}>
      <div className="msign" style={{ width: 'min(420px, calc(100vw - 32px))' }}>
        <h2>Addition order {entry.add.number} — signed</h2>
        {file ? <p className="msign-file">Signed copy: {file.label}</p> : prev && prev.filePath ? <p className="msign-file">The signed copy stays attached.</p> : null}
        <p className="msign-q">What day did he sign it?</p>
        <input style={FIELD} type="date" value={day} max={localDay()} onChange={(e) => setDay(e.target.value)} />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button className="btn-secondary" disabled={busy} onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={busy} onClick={save} style={{ fontWeight: 800 }}>{busy ? 'Saving…' : 'Mark signed'}</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
