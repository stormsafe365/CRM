// ReplacedBadge — a signed quote that "Use as revision" replaced (status
// 'superseded'): a muted grey "Replaced by #<new quote>" tag. The new quote is
// the active order; this one stays only as the record of what was signed.
// Also the REVISED tag of the older Revision Order flow (orange, owner rule:
// no amber / yellow — warnings use #f0883e).

import { contractSentOf, fmtShortDate } from '../lib/contractDocs'

const GREY = { background: '#232b34', color: '#8b95a3', border: '1px solid #33404f' }
const ORANGE = { background: 'rgba(240,136,62,.12)', color: '#f0883e', border: '1px solid rgba(240,136,62,.45)' }
const BASE = { borderRadius: 4, padding: '1px 7px', fontSize: 10, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', whiteSpace: 'nowrap', verticalAlign: 2 }

// "contract sent 10/06/2026" — a generated contract (payload_json.contractSent).
// A small muted tag, not a status: the quote's status stays whatever the rep set.
export function ContractSentTag({ quote: q, style = {} }) {
  const cs = contractSentOf(q)
  if (!cs) return null
  const d = fmtShortDate(cs.at)
  return <span className="contract-sent-tag" title={cs.number ? `Contract ${cs.number} generated` : 'Contract generated'} style={{ color: '#8b95a3', fontSize: 11, fontWeight: 600, marginLeft: 8, whiteSpace: 'nowrap', ...style }}>contract sent{d ? ` ${d}` : ''}</span>
}

export function replacedByNumber(q) {
  const by = q?.payload_json?.revisedBy
  return by && by.quote_number ? String(by.quote_number) : null
}

export default function ReplacedBadge({ quote: q, revisedLabel = 'REVISED', style = {} }) {
  if (!q) return null
  if (q.status === 'superseded') {
    const n = replacedByNumber(q)
    return <span title="Replaced by a revised order — not an active order" style={{ ...BASE, ...GREY, marginLeft: 8, ...style }}>{n ? `Replaced by #${n}` : 'Replaced'}</span>
  }
  if (q.status === 'revised') return <span style={{ ...BASE, ...ORANGE, marginLeft: 8, ...style }}>{revisedLabel}</span>
  return null
}
