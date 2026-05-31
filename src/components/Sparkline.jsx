// Sparkline: small SVG line chart for KPI cards. Self-draws on mount
// (stroke-dashoffset trick). Honors prefers-reduced-motion.

import { useEffect, useRef } from 'react'

const reduceMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

export default function Sparkline({ points, color = 'var(--cyan)', width = 64, height = 30 }) {
  const pathRef = useRef(null)

  // Compute path d-string
  const pad = 2
  const pts = points && points.length > 1 ? points : [0, 0]
  const max = Math.max(...pts)
  const min = Math.min(...pts)
  const range = (max - min) || 1
  const step = (width - pad * 2) / (pts.length - 1)
  const d = pts
    .map((p, i) => {
      const x = pad + i * step
      const y = height - pad - ((p - min) / range) * (height - pad * 2)
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`
    })
    .join(' ')

  useEffect(() => {
    if (reduceMotion()) return
    const path = pathRef.current
    if (!path) return
    const len = path.getTotalLength()
    path.style.strokeDasharray = String(len)
    path.style.strokeDashoffset = String(len)
    // Force a paint, then animate
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        path.style.transition = 'stroke-dashoffset 1s var(--ease-entrance)'
        path.style.strokeDashoffset = '0'
      })
    })
  }, [d])

  return (
    <svg
      className="spark"
      viewBox={`0 0 ${width} ${height}`}
      style={{ width, height }}
    >
      <path
        ref={pathRef}
        d={d}
        fill="none"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
