// Colored badge for showing a quote's status.

import { quoteStatusLabel, quoteStatusColor } from '../lib/constants'

export default function QuoteStatusPill({ status }) {
  const { bg, fg } = quoteStatusColor(status)
  return (
    <span className="status-pill" style={{ background: bg, color: fg }}>
      {quoteStatusLabel(status)}
    </span>
  )
}
