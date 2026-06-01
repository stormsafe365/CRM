// FollowUpControls: a calm cluster of quick presets, a snooze, a custom date,
// and an optional time of day. Presentational only — it calls
// onPick(yyyy-MM-dd, 'HH:MM'|null); the parent decides whether to apply
// immediately (detail page / Today) or stash it (composer).
//
// The DATE always drives "due"; the time is optional and just rides along on
// every pick. `baseDate` is the current follow_up_date (snooze pushes off that,
// else today). `coolingOff` swaps to the wider cadence. No red, no urgency.

import { useState } from 'react'
import { isoToday, addDays, FOLLOWUP_PRESETS, COOLING_PRESETS, fmtLong, fmtTime } from '../lib/followups'

export default function FollowUpControls({
  baseDate,
  coolingOff = false,
  selected = null,
  selectedTime = null,
  onPick,
  includeSnooze = true,
  size = 'md',
}) {
  const [showCustom, setShowCustom] = useState(false)
  // <input type="time"> wants 'HH:MM'; Postgres hands back 'HH:MM:SS'.
  const [time, setTime] = useState(selectedTime ? selectedTime.slice(0, 5) : '')
  const presets = coolingOff ? COOLING_PRESETS : FOLLOWUP_PRESETS
  const snoozeBase = baseDate || isoToday()

  // Every date action carries the current time along.
  const pick = (date) => onPick(date, time || null)
  // Editing the time when a date is already chosen applies it right away.
  const onTimeChange = (v) => {
    setTime(v)
    const d = selected || baseDate
    if (d) onPick(d, v || null)
  }

  return (
    <div className={`fuc fuc-${size}`}>
      {presets.map(p => (
        <button key={p.key} type="button" className="fuc-chip" onClick={() => pick(p.apply())}>
          {p.label}
        </button>
      ))}
      {includeSnooze && (
        <button
          type="button"
          className="fuc-chip fuc-snooze"
          title="Push the existing follow-up out one week, keeping the thread"
          onClick={() => pick(addDays(snoozeBase, 7))}
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
          onChange={e => e.target.value && pick(e.target.value)}
        />
      )}
      <label className="fuc-time-wrap" title="Optional time of day">
        <span className="fuc-time-at">at</span>
        <input
          type="time"
          className="fuc-time"
          value={time}
          onChange={e => onTimeChange(e.target.value)}
        />
      </label>
      {selected && (
        <span className="fuc-selected">→ {fmtLong(selected)}{time ? ` · ${fmtTime(time)}` : ''}</span>
      )}
    </div>
  )
}
