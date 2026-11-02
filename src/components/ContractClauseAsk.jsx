// ContractClauseAsk: the question at Generate Contract (owner 11/2/26: "once we click generate contract there should be an
// option to 'add conditional clause' & then why its conditional"). No clause / conditional upon permit approval /
// conditional upon something else (typed). The answer goes into the quote program (lib/contractClause), which prints
// Addendum A. Same look as PriceChangeConfirm; the picked choice is lime (brand: lime = picked).

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { WHY_MAX, clauseReady, normClause } from '../lib/contractClause'

const LIME = '#a3e635'

function Choice({ on, title, text, onPick, children }) {
  return (
    <label
      style={{
        display: 'block', cursor: 'pointer', borderRadius: 10, padding: '10px 12px', marginTop: 8,
        border: `1.5px solid ${on ? LIME : 'var(--line, #294059)'}`, background: on ? 'rgba(163,230,53,.08)' : 'transparent',
      }}
    >
      <span style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <input type="radio" name="ct-clause" checked={on} onChange={onPick} style={{ marginTop: 3, accentColor: LIME }} />
        <span>
          <span style={{ display: 'block', fontWeight: 700, fontSize: 14 }}>{title}</span>
          {text && <span style={{ display: 'block', fontSize: 12.5, color: 'var(--fg-2, #A6B7C8)', lineHeight: 1.45, marginTop: 2 }}>{text}</span>}
        </span>
      </span>
      {children}
    </label>
  )
}

export default function ContractClauseAsk({ initial, county = '', onAnswer }) {
  const start = normClause(initial)
  const [kind, setKind] = useState(start.kind)
  const [why, setWhy] = useState(start.why)
  const whyRef = useRef(null)
  const answerRef = useRef(onAnswer)
  answerRef.current = onAnswer
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') answerRef.current(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  useEffect(() => { if (kind === 'other') try { whyRef.current?.focus() } catch { /* ignore */ } }, [kind])
  const cty = county && county !== '—' ? `${county.replace(/\s+County$/i, '')} County` : 'the county'
  const ready = clauseReady({ kind, why })
  const go = () => { if (ready) onAnswer(normClause({ kind, why })) }

  return createPortal(
    <div
      role="dialog" aria-modal="true" aria-label="Conditional clause"
      style={{ position: 'fixed', inset: 0, zIndex: 1300, background: 'rgba(4,9,16,.62)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onAnswer(null) }}
    >
      <div style={{
        width: 'min(520px, calc(100vw - 32px))', maxHeight: 'calc(100vh - 64px)', overflow: 'auto',
        background: 'var(--card, #0D1929)', border: '1px solid var(--line, #294059)',
        borderRadius: 14, padding: 18, boxShadow: '0 18px 60px rgba(0,0,0,.5)', color: 'var(--fg, #e2e8f0)',
      }}>
        <h2 style={{ margin: '2px 0 6px', fontSize: 17 }}>Add a conditional clause?</h2>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--fg-2, #A6B7C8)', lineHeight: 1.5 }}>
          The contract says all deposits are non-refundable. A conditional clause adds a signed <strong>Addendum A</strong>: the
          deposit is refunded in full if the condition is not met.
        </p>
        <Choice on={kind === ''} title="No conditional clause" text="The standard contract." onPick={() => setKind('')} />
        <Choice
          on={kind === 'permit'}
          title="Conditional upon permit approval"
          text={`Deposit refunded only if ${cty} denies the building permit in writing. Approval with changes is not a denial; the plans and permit service are not refunded.`}
          onPick={() => setKind('permit')}
        />
        <Choice on={kind === 'other'} title="Conditional upon something else" text="Type what the contract is conditional upon." onPick={() => setKind('other')}>
          {kind === 'other' && (
            <input
              ref={whyRef}
              value={why}
              maxLength={WHY_MAX}
              onChange={(e) => setWhy(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') go() }}
              placeholder="e.g. the buyer's financing being approved by the bank"
              aria-label="Conditional upon"
              style={{ width: '100%', marginTop: 8, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--line, #294059)', background: 'var(--bg, #08121d)', color: 'inherit', fontSize: 13.5 }}
            />
          )}
        </Choice>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button type="button" className="btn-secondary" onClick={() => onAnswer(null)}>Cancel</button>
          <button type="button" className="btn-primary" style={{ fontWeight: 800 }} disabled={!ready} onClick={go}>Continue</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
