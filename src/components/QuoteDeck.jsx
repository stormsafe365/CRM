// QuoteDeck: an interactive, swipeable stack of a client's quotes.
// Ported from the prototype's quote deck, following the "order is the
// single source of truth; layout() is pure; CSS does the motion" model.
//
//   • Front card = order[0]. Cards never move in the DOM.
//   • layout() sets each card's transform from its position in `order`.
//   • Arrows / ← → keys / drag-aside flip. Drag-up "accepts".
//
// React renders the card content; positioning + drag are imperative
// (refs + inline transforms) exactly as the deck pattern wants.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { quoteStatusLabel, quoteStatusColor } from '../lib/constants'

const money = (n) => (n == null || n === '' ? null : '$' + Number(n).toLocaleString())
const mfrLabel = (m) => (m === 'ca' ? 'CA' : m === 'cci' ? 'CCI' : null)
const fmtDate = (d) => {
  if (!d) return ''
  const [y, mo, da] = d.split('-')
  return new Date(y, mo - 1, da).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export default function QuoteDeck({ quotes, onOpen, onViewPdf, onAccept, onDelete }) {
  const stageRef = useRef(null)
  const cardRefs = useRef([])
  const dragRef = useRef(null)
  const [order, setOrder] = useState(() => quotes.map((_, i) => i))

  // Reset stacking order when the set of quotes changes size.
  useEffect(() => { setOrder(quotes.map((_, i) => i)) }, [quotes.length])

  // Pure layout: presentation is a function of `order`.
  function layout() {
    order.forEach((ii, pos) => {
      const el = cardRefs.current[ii]
      if (!el) return
      if (pos === 0) {
        el.classList.add('front')
        el.style.transform = 'translate(0,0) scale(1) rotate(0deg)'
        el.style.opacity = 1
        el.style.zIndex = 200
        el.style.pointerEvents = 'auto'
      } else {
        el.classList.remove('front')
        el.style.transform = `translate(${pos * 15}px, ${pos * 7}px) scale(${1 - pos * 0.04}) rotate(${pos * 2.4}deg)`
        el.style.opacity = pos < 5 ? 1 - pos * 0.14 : 0
        el.style.zIndex = 200 - pos
        el.style.pointerEvents = 'none'
      }
    })
  }
  useLayoutEffect(layout, [order, quotes])

  function next() { setOrder(o => { const n = [...o]; n.push(n.shift()); return n }) }
  function prev() { setOrder(o => { const n = [...o]; n.unshift(n.pop()); return n }) }

  // Keyboard flip
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'ArrowRight') next()
      else if (e.key === 'ArrowLeft') prev()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ---- drag-to-throw (front card only) ----
  function onPointerDown(e) {
    const frontEl = cardRefs.current[order[0]]
    if (!frontEl) return
    const card = e.target.closest('.qd-card')
    if (card !== frontEl) return
    if (e.target.closest('button')) return // let buttons click
    dragRef.current = { x: e.clientX, y: e.clientY, el: frontEl, dx: 0, dy: 0 }
    frontEl.style.transition = 'none'
    frontEl.setPointerCapture?.(e.pointerId)
  }
  function onPointerMove(e) {
    const d = dragRef.current
    if (!d) return
    d.dx = e.clientX - d.x
    d.dy = e.clientY - d.y
    d.el.style.transform = `translate(${d.dx}px, ${d.dy}px) rotate(${d.dx / 16}deg)`
  }
  function onPointerUp() {
    const d = dragRef.current
    if (!d) return
    const { dx, dy, el } = d
    dragRef.current = null
    el.style.transition = '' // restore CSS transition so the settle animates
    if (dy < -120 && Math.abs(dy) > Math.abs(dx)) {
      // swipe up = accept: fly it off the top, then advance
      el.style.transform = `translate(${dx}px, -640px) rotate(${dx / 16}deg)`
      const accepted = quotes[order[0]]
      setTimeout(() => { onAccept?.(accepted); next() }, 240)
    } else if (Math.hypot(dx, dy) > 120) {
      next() // thrown aside
    } else {
      layout() // snap back
    }
  }

  if (!quotes.length) return null

  return (
    <div className="qd-wrap">
      <div
        className="qd-stage"
        ref={stageRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {quotes.map((q, i) => (
          <article key={q.id} ref={el => (cardRefs.current[i] = el)} className="qd-card">
            <div className="qd-head">
              <span className="qd-id">{q.quote_number ? '#' + q.quote_number : 'QUOTE'}</span>
              <span className="qd-status" style={{ background: quoteStatusColor(q.status).bg, color: quoteStatusColor(q.status).fg }}>
                {quoteStatusLabel(q.status)}
              </span>
            </div>

            <div className="qd-title">{q.building_size || q.building_summary || 'Building quote'}</div>
            {q.building_summary && q.building_size && <div className="qd-sub">{q.building_summary}</div>}

            {q.notes && <div className="qd-note">⟳ {q.notes}</div>}

            <div className="qd-lines">
              {money(q.deposit_amount) && <Row k="Deposit" v={money(q.deposit_amount)} />}
              {money(q.balance_amount) && <Row k="Balance due" v={money(q.balance_amount)} />}
              {mfrLabel(q.manufacturer) && <Row k="Built with" v={mfrLabel(q.manufacturer)} />}
            </div>

            <div className="qd-total">
              <span className="qd-total-lbl">Quote Total</span>
              <span className="qd-total-val num">{money(q.total_amount) || '—'}</span>
            </div>

            <div className="qd-foot">
              <span className="qd-date">{fmtDate(q.quote_date)}{mfrLabel(q.manufacturer) ? ` · ${mfrLabel(q.manufacturer)}` : ''}</span>
              <div className="qd-actions">
                {q.pdf_snapshot_url && (
                  <button className="qd-btn" onClick={() => onViewPdf(q.pdf_snapshot_url)}>PDF</button>
                )}
                <button className="qd-btn" onClick={() => onOpen(q)}>Open / Edit</button>
                {onDelete && <button className="qd-btn" onClick={() => onDelete(q)} style={{ color: 'var(--danger, #FF5C5C)' }}>Delete</button>}
              </div>
            </div>
          </article>
        ))}
      </div>

      <div className="qd-controls">
        <button className="qd-nav" onClick={prev} aria-label="Previous quote">←</button>
        <span className="qd-counter num">{(order[0] ?? 0) + 1} / {quotes.length}</span>
        <button className="qd-nav" onClick={next} aria-label="Next quote">→</button>
      </div>
      <div className="qd-hint">Drag aside to flip · drag <b>up</b> to accept · ← → keys</div>
    </div>
  )
}

function Row({ k, v }) {
  return (
    <div className="qd-line">
      <span className="qd-line-k">{k}</span>
      <span className="qd-line-v num">{v}</span>
    </div>
  )
}
