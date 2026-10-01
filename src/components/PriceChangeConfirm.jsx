// PriceChangeConfirm: the ONE confirm dialog every builder write to a saved
// quote goes through (Update Quote / the program's Save + Generate Contract
// buttons / Generate Contract + Executed Copy from a card / Finish Revision).
// Shows saved → new for total, deposit and balance (and says so when nothing
// changed). Built from lib/priceLockCrm writeCheck(). Cancel is the default
// button when the price changes; OK when it does not.

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { fmtDelta, fmtMoney } from '../lib/priceLockCrm'

const CELL = { padding: '6px 8px', borderBottom: '1px solid var(--line, #294059)', fontVariantNumeric: 'tabular-nums' }
const HEAD = { ...CELL, fontSize: 11, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--fg-3, #8598AC)', fontWeight: 700 }

export default function PriceChangeConfirm({ check, onAnswer }) {
  const cancelRef = useRef(null)
  const okRef = useRef(null)
  const answerRef = useRef(onAnswer)
  answerRef.current = onAnswer
  const quiet = check.changed === false && !(check.lines || []).some((l) => Math.abs(l.delta) >= 0.005)
  useEffect(() => {
    try { (quiet ? okRef : cancelRef).current?.focus() } catch { /* ignore */ }
    const onKey = (e) => { if (e.key === 'Escape') answerRef.current(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const changed = (check.lines || []).some((l) => Math.abs(l.delta) >= 0.005)
  return createPortal(
    <div
      role="dialog" aria-modal="true" aria-label={check.title}
      style={{ position: 'fixed', inset: 0, zIndex: 1300, background: 'rgba(4,9,16,.62)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onAnswer(false) }}
    >
      <div style={{
        width: 'min(500px, calc(100vw - 32px))', maxHeight: 'calc(100vh - 64px)', overflow: 'auto',
        background: 'var(--card, #0D1929)', border: `1px solid ${changed ? 'rgba(255,181,71,.55)' : 'var(--line, #294059)'}`,
        borderRadius: 14, padding: 18, boxShadow: '0 18px 60px rgba(0,0,0,.5)', color: 'var(--fg, #e2e8f0)',
      }}>
        <h2 style={{ margin: '2px 0 10px', fontSize: 17 }}>{check.title}</h2>
        {(check.lines || []).length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
            <thead>
              <tr>
                <th style={{ ...HEAD, textAlign: 'left' }} />
                <th style={{ ...HEAD, textAlign: 'right' }}>Saved</th>
                <th style={{ ...HEAD, textAlign: 'right' }}>New</th>
                <th style={{ ...HEAD, textAlign: 'right' }}>Change</th>
              </tr>
            </thead>
            <tbody>
              {check.lines.map((l) => {
                const moved = Math.abs(l.delta) >= 0.005
                return (
                  <tr key={l.label}>
                    <td style={{ ...CELL, color: 'var(--fg-3, #8598AC)' }}>{l.label}</td>
                    <td style={{ ...CELL, textAlign: 'right' }}>{fmtMoney(l.from)}</td>
                    <td style={{ ...CELL, textAlign: 'right', fontWeight: 700 }}>{fmtMoney(l.to)}</td>
                    <td style={{ ...CELL, textAlign: 'right', fontWeight: 700, color: moved ? '#FFB547' : 'var(--fg-3, #8598AC)' }}>{fmtDelta(l.delta)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
        {(check.notes || []).length > 0 && (
          <ul style={{ margin: '12px 0 0', paddingLeft: 18, fontSize: 12.5, color: 'var(--fg-2, #A6B7C8)', lineHeight: 1.5 }}>
            {check.notes.map((n, i) => <li key={i}>{n}</li>)}
          </ul>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button type="button" ref={cancelRef} className="btn-secondary" onClick={() => onAnswer(false)}>Cancel</button>
          <button type="button" ref={okRef} className="btn-primary" style={{ fontWeight: 800 }} onClick={() => onAnswer(true)}>{check.okLabel}</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
