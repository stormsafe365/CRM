// Starred quote (owner 10/6/26): one quote per lead is starred — the one the
// client is leaning towards / ordered. It sorts first in every quote list and
// is the quote Open Layout (Document Hub) reflects. Hidden until migration
// 019_quotes_starred.sql adds quotes.starred (see layoutFromQuote.starSupported).

import { STAR_TOOLTIP } from '../lib/layoutFromQuote'

const starPath = 'M12 2.8l2.8 5.7 6.3.9-4.55 4.43 1.07 6.27L12 17.13 6.38 20.1l1.07-6.27L2.9 9.4l6.3-.9z'

export function StarIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true"><path d={starPath} /></svg>
}

/** Toggle button (renders nothing when the star isn't available). */
export function StarButton({ quote, onToggle, busy }) {
  if (!onToggle || !quote) return null
  const on = quote.starred === true
  return (
    <button
      type="button"
      className={`q-star-btn${on ? ' on' : ''}`}
      aria-pressed={on}
      aria-label={on ? 'Unstar this quote' : 'Star this quote'}
      title={on ? STAR_TOOLTIP : 'Star this quote — the one the client is leaning towards / ordered. Open Layout uses the starred quote.'}
      disabled={!!busy}
      onClick={(e) => { e.stopPropagation(); onToggle(quote) }}
    >
      <StarIcon />
    </button>
  )
}

/** "★ Starred" badge next to the quote number. */
export function StarBadge({ quote }) {
  if (!quote || quote.starred !== true) return null
  return <span className="q-star-badge" title={STAR_TOOLTIP}><StarIcon />Starred</span>
}
