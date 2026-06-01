// LeadTempSlider: an interactive thermometer for lead temperature.
// Drag the glowing knob (or click a level / use arrow keys) to set
// Cold → Warm → Hot → Ready to Close. Neumorphic groove + raised knob,
// color + glow track the active level, and the knob animates between stops.
// Presentational: calls onChange(levelKey); parent persists + stamps who/when.

import { useRef, useState } from 'react'
import { fmtLong } from '../lib/followups'

const TEMP_LEVELS = [
  { key: 'cold',  label: 'Cold',           color: '#38bdf8' },
  { key: 'warm',  label: 'Warm',           color: '#6ee7a8' },
  { key: 'hot',   label: 'Hot',            color: '#fb7a3c' },
  { key: 'ready', label: 'Ready to Close', color: '#f87171' },
]

const LAST = TEMP_LEVELS.length - 1

export default function LeadTempSlider({ value, updatedAt, updatedByName, onChange }) {
  const trackRef = useRef(null)
  const [dragFrac, setDragFrac] = useState(null) // 0..1 while actively dragging

  const setIdx = TEMP_LEVELS.findIndex(l => l.key === value)
  const hasValue = setIdx >= 0
  const baseFrac = hasValue ? setIdx / LAST : 0
  const frac = dragFrac != null ? dragFrac : baseFrac
  const liveIdx = Math.round(frac * LAST)
  const active = TEMP_LEVELS[liveIdx]
  const dragging = dragFrac != null

  function fracFromClientX(clientX) {
    const rect = trackRef.current.getBoundingClientRect()
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
  }

  function startDrag(e) {
    e.preventDefault()
    trackRef.current?.focus?.()
    setDragFrac(fracFromClientX(e.clientX))
    const move = (ev) => setDragFrac(fracFromClientX(ev.clientX))
    const up = (ev) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      const idx = Math.round(fracFromClientX(ev.clientX) * LAST)
      setDragFrac(null)
      commit(idx)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  function commit(idx) {
    const key = TEMP_LEVELS[Math.min(LAST, Math.max(0, idx))].key
    if (key !== value) onChange(key)
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); commit((hasValue ? setIdx : -1) + 1) }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); commit((hasValue ? setIdx : LAST + 1) - 1) }
  }

  return (
    <div className="lts">
      <div className="lts-row">
        <span className="lts-thermo" aria-hidden style={{ color: hasValue ? active.color : 'var(--txt-3)' }}>🌡</span>
        <div
          className="lts-track"
          ref={trackRef}
          role="slider"
          tabIndex={0}
          aria-label="Lead temperature"
          aria-valuetext={hasValue ? active.label : 'Not set'}
          aria-valuemin={0} aria-valuemax={LAST} aria-valuenow={hasValue ? setIdx : 0}
          onPointerDown={startDrag}
          onKeyDown={onKeyDown}
        >
          {TEMP_LEVELS.map((l, i) => (
            <button
              key={l.key}
              type="button"
              className={`lts-stop${i <= liveIdx && hasValue ? ' passed' : ''}`}
              style={{ left: `${(i / LAST) * 100}%` }}
              onClick={(e) => { e.stopPropagation(); commit(i) }}
              aria-label={l.label}
              tabIndex={-1}
            />
          ))}
          <div
            className={`lts-knob${dragging ? ' dragging' : ''}${hasValue ? '' : ' unset'}`}
            style={{ left: `${frac * 100}%`, '--knob': active.color }}
          />
        </div>
      </div>

      <div className="lts-labels">
        {TEMP_LEVELS.map((l, i) => (
          <button
            key={l.key}
            type="button"
            className={`lts-label${hasValue && i === setIdx ? ' on' : ''}`}
            style={hasValue && i === setIdx ? { color: l.color } : undefined}
            onClick={() => commit(i)}
          >
            {l.label}
          </button>
        ))}
      </div>

      <div className="lts-meta">
        <span>Current Status: <b style={{ color: hasValue ? active.color : 'var(--txt-3)' }}>{hasValue ? active.label : 'Not set'}</b></span>
        {updatedAt && <span className="lts-meta-sub">Last Updated: {fmtLong(updatedAt.slice(0, 10))}</span>}
        {updatedByName && updatedByName !== '—' && <span className="lts-meta-sub">Updated By: {updatedByName}</span>}
      </div>
    </div>
  )
}
