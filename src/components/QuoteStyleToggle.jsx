// QuoteStyleToggle: the "Quote PDF" style choice in the 3D Builder bars (per-lead
// BuildQuoteModal and the 3D Builder tab), next to Save to Lead — the button that
// generates and attaches the quote PDF. Shares the program's own choice (see
// lib/quoteStyle), so a change on either side shows on the other.
// One switch (owner 11/2/26: "replace the dark mode & light mode buttons with a toggle ... make it fit the StormSafe
// theme"): moon = Dark (on-screen) pages, sun = White (print-friendly) pages.

import { useEffect, useId, useState } from 'react'
import { QUOTE_STYLE_KEY, QUOTE_STYLES, readQuoteStyle, writeQuoteStyle } from '../lib/quoteStyle'

const MOON = 'M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z'
const SUN = 'M12 7.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zM12 1.5v2.2M12 20.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M1.5 12h2.2M20.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6'
const Icon = ({ d }) => (
  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false">
    <path d={d} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

export default function QuoteStyleToggle({ getProgramWindow }) {
  const [style, setStyle] = useState(() => readQuoteStyle())
  const uid = useId()

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
  const white = style === 'white'
  const now = QUOTE_STYLES.find((o) => o.value === style) || QUOTE_STYLES[0]
  const next = QUOTE_STYLES.find((o) => o.value !== style) || QUOTE_STYLES[1]

  return (
    <div className="qb-style">
      <span className="qb-style-l" id={uid + 'l'}>Quote PDF</span>
      <button
        type="button"
        role="switch"
        aria-checked={white}
        aria-labelledby={uid + 'l'}
        aria-describedby={uid + 'n'}
        className={`qb-sw${white ? ' is-white' : ''}`}
        title={`${now.title}. Click for ${next.label}.`}
        onClick={() => pick(white ? 'dark' : 'white')}
      >
        <span className="qb-sw-ico qb-sw-ico-moon"><Icon d={MOON} /></span>
        <span className="qb-sw-ico qb-sw-ico-sun"><Icon d={SUN} /></span>
        <span className="qb-sw-knob"><Icon d={white ? SUN : MOON} /></span>
      </button>
      <span className="qb-style-now" id={uid + 'n'}>{white ? 'White' : 'Dark'}</span>
    </div>
  )
}
