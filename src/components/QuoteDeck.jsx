// QuoteDeck: a wide, swipeable quote card for a client's quotes (one at a time,
// arrows + dots + ← → keys). Left = the 3D rendering captured when the quote was
// saved; right = the quote details. Actions: View PDF · Open/Edit · Duplicate ·
// Delete. Matches the client-portal quote-card design.

import { useEffect, useState } from 'react'
import { userLabel } from '../lib/useUsers'

const money = (n) => (n == null || n === '' ? null : '$' + Number(n).toLocaleString())
const mfrLabel = (m) => (m === 'ca' ? 'CA' : m === 'cci' ? 'CCI' : null)

const fmtDate = (d) => {
  if (!d) return ''
  const [y, mo, da] = d.split('-')
  return new Date(y, mo - 1, da).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
// "18x35x14" → "18′ × 35′ × 14′"
const fmtDims = (s) => {
  if (!s) return null
  const parts = String(s).split(/\s*[x×]\s*/i).filter(Boolean)
  return parts.length ? parts.map(p => `${p}′`).join(' × ') : String(s)
}

const calIcon = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M3 10h18M8 2v4M16 2v4" /></svg>
const userIcon = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
const imgIcon = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.5-3.5L8 21" /></svg>

export default function QuoteDeck({ quotes, users, onOpen, onViewPdf, onDelete, onDuplicate, onGenerateContract }) {
  const [idx, setIdx] = useState(0)
  const n = quotes.length

  useEffect(() => { setIdx(i => Math.min(i, Math.max(0, n - 1))) }, [n])

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'ArrowRight') setIdx(i => (i + 1) % n)
      else if (e.key === 'ArrowLeft') setIdx(i => (i - 1 + n) % n)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [n])

  if (!n) return null
  const q = quotes[Math.min(idx, n - 1)]
  const c = q.payload_json?.card || {}
  const thumb = q.payload_json?.rendering_thumb || null
  const colors = [c.roofColor, c.wallColor].filter(Boolean).join(' / ') || null
  const canContract = !!(q.payload_json && (q.payload_json.fields || q.payload_json.source === '3d-builder'))
  const creator = userLabel(users, q.created_by)
  const prev = () => setIdx(i => (i - 1 + n) % n)
  const next = () => setIdx(i => (i + 1) % n)

  return (
    <div className="qcard-wrap">
      <article className="qcard" key={q.id}>
        <div className="qcard-main">
          <div className="qcard-media">
            {thumb
              ? <img src={thumb} alt="3D rendering of the building" />
              : <div className="qcard-media-empty">{imgIcon}<span>No rendering yet</span></div>}
            <span className="qcard-date">{calIcon}{fmtDate(q.quote_date)}</span>
          </div>

          <div className="qcard-body">
            <div className="qcard-num">{q.quote_number ? '#' + q.quote_number : 'QUOTE'}</div>
            <div className="qcard-dims num">{fmtDims(q.building_size) || q.building_summary || 'Building quote'}</div>
            {q.building_summary && q.building_size && <div className="qcard-subtitle">{c.buildingType || q.building_summary}</div>}

            {(mfrLabel(q.manufacturer) || colors || c.foundation) && (
              <>
                <div className="qcard-divider" />
                <div className="qcard-specs">
                  {mfrLabel(q.manufacturer) && <Spec k="Manufacturer" v={mfrLabel(q.manufacturer)} />}
                  {colors && <Spec k="Roof / Wall Color" v={colors} />}
                  {c.foundation && <Spec k="Foundation" v={c.foundation} />}
                </div>
              </>
            )}

            {(money(q.deposit_amount) || money(q.balance_amount)) && (
              <>
                <div className="qcard-divider" />
                <div className="qcard-specs">
                  {money(q.deposit_amount) && <Spec k="Deposit" v={money(q.deposit_amount)} mono />}
                  {money(q.balance_amount) && <Spec k="Balance Due" v={money(q.balance_amount)} mono />}
                </div>
              </>
            )}

            <div className="qcard-total">
              <span className="qcard-total-l">Quote Total</span>
              <span className="qcard-total-v num">{money(q.total_amount) || '—'}</span>
            </div>
          </div>

          {n > 1 && <>
            <button className="qcard-nav left" onClick={prev} aria-label="Previous quote">‹</button>
            <button className="qcard-nav right" onClick={next} aria-label="Next quote">›</button>
          </>}
        </div>

        <div className="qcard-foot">
          <span className="qcard-creator">{userIcon} Created by {creator !== '—' ? creator : 'you'}</span>
          <div className="qcard-actions">
            {q.pdf_snapshot_url && <button className="qcard-btn" onClick={() => onViewPdf(q.pdf_snapshot_url)}>View PDF</button>}
            <button className="qcard-btn primary" onClick={() => onOpen(q)}>Open / Edit</button>
            {onGenerateContract && canContract && <button className="qcard-btn" onClick={() => onGenerateContract(q)}>Generate Contract</button>}
            {onDuplicate && <button className="qcard-btn" onClick={() => onDuplicate(q)}>Duplicate</button>}
            {onDelete && <button className="qcard-btn danger" onClick={() => onDelete(q)}>Delete</button>}
          </div>
        </div>
      </article>

      {n > 1 && (
        <div className="qcard-dots">
          {quotes.map((_, i) => (
            <button key={i} className={`qcard-dot${i === idx ? ' on' : ''}`} onClick={() => setIdx(i)} aria-label={`Quote ${i + 1}`} />
          ))}
        </div>
      )}
      <div className="qcard-hint">{n > 1 ? <>Swipe through the deck · <b>← →</b> to navigate</> : 'Your saved quotes appear here'}</div>
    </div>
  )
}

function Spec({ k, v, mono }) {
  return (
    <div className="qcard-spec">
      <span className="qcard-spec-k">{k}</span>
      <span className={`qcard-spec-v${mono ? ' num' : ''}`}>{v}</span>
    </div>
  )
}
