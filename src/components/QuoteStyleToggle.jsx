// QuoteStyleToggle: the "Quote PDF" style choice in the 3D Builder bars (per-lead
// BuildQuoteModal and the 3D Builder tab), next to Save to Lead — the button that
// generates and attaches the quote PDF. Shares the program's own choice (see
// lib/quoteStyle), so a change on either side shows on the other.

import { useEffect, useState } from 'react'
import { QUOTE_STYLE_KEY, QUOTE_STYLES, readQuoteStyle, writeQuoteStyle } from '../lib/quoteStyle'

export default function QuoteStyleToggle({ getProgramWindow }) {
  const [style, setStyle] = useState(() => readQuoteStyle())

  // The program's own control (or another CRM window) changed it.
  useEffect(() => {
    const onStorage = (e) => { if (!e.key || e.key === QUOTE_STYLE_KEY) setStyle(readQuoteStyle()) }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const pick = (v) => {
    let program = null
    try { program = getProgramWindow ? getProgramWindow() : null } catch { program = null }
    setStyle(writeQuoteStyle(v, { program }))
  }

  return (
    <div className="qb-style" role="radiogroup" aria-label="Quote PDF style">
      <span className="qb-style-l">Quote PDF</span>
      {QUOTE_STYLES.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={style === o.value}
          className={`qb-style-b${style === o.value ? ' on' : ''}`}
          title={o.title}
          onClick={() => pick(o.value)}
        >
          <span className={`qb-style-sw qb-style-sw-${o.value}`} aria-hidden="true" />
          {/* full wording on a wide window, one word on a narrower one (styles.css) */}
          <span className="qb-style-long">{o.label}</span>
          <span className="qb-style-short">{o.short}</span>
        </button>
      ))}
    </div>
  )
}
