// LeadTempSlider: the lead-temperature gauge in the lead header.
// Skinned to the mockup (.temp-track gradient + draggable .temp-knob, 6-stop
// scale). Drag the knob, click the track, or use arrow keys to set the stage.
// Presentational: calls onChange(levelKey); parent persists + stamps who/when.

import { useRef, useState } from 'react'
import { fmtLong } from '../lib/followups'

// Seven stops, matching the sales stages (labels per StormSafe spec).
// 'working' sits between Warm (attempting contact) and Hot — a spoken-to lead
// that isn't hot yet.
const TEMP_LEVELS = [
  { key: 'cold',            label: 'Cold',            color: '#6FC9E8' },
  { key: 'warm',            label: 'Warm',            color: '#5FD98F' },
  { key: 'working',         label: 'Working',         color: '#86D45A' },
  { key: 'hot',             label: 'Hot',             color: '#C8D14F' },
  { key: 'ready',           label: 'Ready to Close',  color: '#FFB547' },
  { key: 'pending_deposit', label: 'Pending Deposit', color: '#FF5C5C' },
  { key: 'ordered',         label: 'Ordered',         color: '#22C55E' },
]
const LAST = TEMP_LEVELS.length - 1

export default function LeadTempSlider({ value, updatedAt, updatedByName, onChange }) {
  const trackRef = useRef(null)
  const [dragFrac, setDragFrac] = useState(null) // 0..1 while actively dragging

  // Legacy 4-stop value 'ready' still maps cleanly to index 3.
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
    <div className="temp-wrap">
      <svg className="thermo" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z" />
      </svg>
      <div className="temp-body">
        <div
          className="temp-track"
          ref={trackRef}
          role="slider"
          tabIndex={0}
          aria-label="Lead temperature"
          aria-valuetext={hasValue ? active.label : 'Not set'}
          aria-valuemin={0} aria-valuemax={LAST} aria-valuenow={hasValue ? setIdx : 0}
          onPointerDown={startDrag}
          onKeyDown={onKeyDown}
          style={{ cursor: 'pointer' }}
        >
          <div
            className={`temp-knob${dragging ? ' dragging' : ''}`}
            style={{ left: `${frac * 100}%`, borderColor: hasValue ? active.color : undefined }}
          />
        </div>
        <div className="temp-scale seven">
          {TEMP_LEVELS.map(l => <span key={l.key}>{l.label}</span>)}
        </div>
        <div className="temp-meta">
          <div className="tm-row">
            <span>Current Status: <b style={{ color: hasValue ? active.color : 'var(--fg-3)' }}>{hasValue ? active.label : 'Not set'}</b></span>
            {updatedAt && <span>Last Updated: <b className="num">{fmtLong(updatedAt.slice(0, 10))}</b></span>}
          </div>
          {updatedByName && updatedByName !== '—' && (
            <div className="tm-row"><span>Updated By: <b>{updatedByName}</b></span></div>
          )}
        </div>
      </div>
    </div>
  )
}
