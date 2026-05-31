// Small colored badge for showing a client's pipeline status.

import { statusLabel, statusColor } from '../lib/constants'

export default function StatusPill({ status }) {
  const { bg, fg } = statusColor(status)
  return (
    <span
      className="status-pill"
      style={{ background: bg, color: fg }}
    >
      {statusLabel(status)}
    </span>
  )
}
