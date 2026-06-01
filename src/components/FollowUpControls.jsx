// FollowUpControls: a calm cluster of quick presets, a snooze, and a custom
// date. Presentational only — it calls onPick(yyyy-MM-dd); the parent decides
// whether to apply immediately (detail page / Today) or stash it (composer).
//
// `baseDate` is the current follow_up_date (snooze pushes off that, else today).
// `coolingOff` swaps to the wider cadence. No red, no urgency — just options.

import { useState } from 'react'
import { isoToday, addDays, FOLLOWUP_PRESETS, COOLING_PRESETS, fmtLong } from '../lib/followups'

export default function FollowUpControls({
  baseDate,
  coolingOff = false,
  selected = null,
  onPick,
  includeSnooze = true,
  size = 'md',
}) {
  const [showCustom, setShowCustom] = useState(false)
  const presets = coolingOff ? COOLING_PRESETS : FOLLOWUP_PRESETS
  const snoozeBase = baseDate || isoToday()

  return (
    <div className={`fuc fuc-${size}`}>
      {presets.map(p => (
        <button key={p.key} type="button" className="fuc-chip" onClick={() => onPick(p.apply())}>
          {p.label}
        </button>
      ))}
      {includeSnooze && (
        <button
          type="button"
          className="fuc-chip fuc-snooze"
          title="Push the existing follow-up out one week, keeping the thread"
          onClick={() => onPick(addDays(snoozeBase, 7))}
        >
          Snooze 1 wk
        </button>
      )}
      <button type="button" className="fuc-chip fuc-custom" onClick={() => setShowCustom(s => !s)}>
        Custom…
      </button>
      {showCustom && (
        <input
          type="date"
          className="fuc-date"
          defaultValue={selected || isoToday()}
          onChange={e => e.target.value && onPick(e.target.value)}
        />
      )}
      {selected && <span className="fuc-selected">→ {fmtLong(selected)}</span>}
    </div>
  )
}
