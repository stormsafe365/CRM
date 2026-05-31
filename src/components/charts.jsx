// Dashboard charts — hand-built SVG, ported 1:1 from the prototype's
// drawing code (js/dashboard.js + js/util.js) into self-contained React
// components. Each self-draws on mount (stroke-dashoffset / scaleX) and
// honors prefers-reduced-motion. No chart library.

import { useEffect, useRef } from 'react'

const reduceMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

/* ------------------------------------------------------------------ */
/* AreaChart — quotes-sent style time series.                          */
/* points: number[]  labels: string[]  peakText: string               */
/* ------------------------------------------------------------------ */
export function AreaChart({ points = [], labels = [], peakText = '' }) {
  const svgRef = useRef(null)
  const tipRef = useRef(null)

  useEffect(() => {
    const svg = svgRef.current
    const tip = tipRef.current
    if (!svg || points.length < 2) return

    const reduce = reduceMotion() || document.hidden
    const W = 520, H = 200, padL = 34, padR = 12, padT = 14, padB = 26
    const max = Math.max(...points) * 1.15 || 1
    const stepX = (W - padL - padR) / (points.length - 1)
    const coords = points.map((p, i) => [padL + i * stepX, H - padB - (p / max) * (H - padT - padB)])

    let grid = ''
    const ticks = 4
    for (let g = 0; g <= ticks; g++) {
      const yy = padT + (H - padT - padB) * g / ticks
      grid += `<line class="gridline" x1="${padL}" y1="${yy.toFixed(1)}" x2="${W - padR}" y2="${yy.toFixed(1)}"/>`
      grid += `<text class="axis" x="${padL - 8}" y="${(yy + 3).toFixed(1)}" text-anchor="end">${Math.round(max * (1 - g / ticks))}</text>`
    }
    const xlabels = labels.map((l, i) =>
      `<text class="axis" x="${coords[i][0].toFixed(1)}" y="${H - 8}" text-anchor="middle">${l}</text>`
    ).join('')
    const line = coords.map((c, i) => `${i ? 'L' : 'M'}${c[0].toFixed(1)} ${c[1].toFixed(1)}`).join(' ')
    const area = `M${coords[0][0].toFixed(1)} ${H - padB} ` +
      coords.map(c => `L${c[0].toFixed(1)} ${c[1].toFixed(1)}`).join(' ') +
      ` L${coords[coords.length - 1][0].toFixed(1)} ${H - padB} Z`

    svg.innerHTML =
      '<defs><linearGradient id="ag" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="var(--cyan)" stop-opacity="0.34"/>' +
      '<stop offset="100%" stop-color="var(--cyan)" stop-opacity="0"/></linearGradient></defs>' +
      grid + xlabels +
      `<path id="areaFill" d="${area}" fill="url(#ag)" opacity="0"/>` +
      `<path id="areaLine" d="${line}" fill="none" stroke="var(--cyan)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>` +
      '<circle id="areaDot" r="4.5" fill="var(--cyan)" stroke="var(--bg)" stroke-width="2" opacity="0"/>'

    const lineEl = svg.querySelector('#areaLine')
    const fillEl = svg.querySelector('#areaFill')
    const dotEl = svg.querySelector('#areaDot')
    const peakIdx = points.indexOf(Math.max(...points))
    dotEl.setAttribute('cx', coords[peakIdx][0].toFixed(1))
    dotEl.setAttribute('cy', coords[peakIdx][1].toFixed(1))
    if (tip && peakText) {
      tip.innerHTML = `Peak <b>${peakText}</b>`
      tip.style.left = (coords[peakIdx][0] / W * 100) + '%'
      tip.style.top = (coords[peakIdx][1] / H * 100) + '%'
    }

    if (reduce) {
      fillEl.style.opacity = 1
      dotEl.setAttribute('opacity', '1')
      if (tip) tip.style.opacity = 1
      return
    }
    const len = lineEl.getTotalLength()
    lineEl.style.strokeDasharray = len
    lineEl.style.strokeDashoffset = len
    requestAnimationFrame(() => requestAnimationFrame(() => {
      lineEl.style.transition = 'stroke-dashoffset 1.3s var(--ease-entrance)'
      lineEl.style.strokeDashoffset = 0
    }))
    const t1 = setTimeout(() => { fillEl.style.transition = 'opacity .6s var(--ease-entrance)'; fillEl.style.opacity = 1 }, 700)
    const t2 = setTimeout(() => { dotEl.style.transition = 'opacity .4s'; dotEl.setAttribute('opacity', '1'); if (tip) tip.style.opacity = 1 }, 1200)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [points, labels, peakText])

  if (points.length < 2) {
    return <div className="chart-empty">Not enough quote history yet.<br />Quotes you send will chart here.</div>
  }
  return (
    <div className="area-wrap">
      <svg ref={svgRef} className="chart" viewBox="0 0 520 200" preserveAspectRatio="none" />
      <div ref={tipRef} className="peak-tip" />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Donut — value split by category.                                    */
/* segments: [{ value:number, color:string }]                          */
/* ------------------------------------------------------------------ */
export function Donut({ segments = [] }) {
  const svgRef = useRef(null)
  const total = segments.reduce((a, s) => a + s.value, 0)

  useEffect(() => {
    const svg = svgRef.current
    if (!svg || total <= 0) return
    const reduce = reduceMotion() || document.hidden
    const cx = 80, cy = 80, r = 58, C = 2 * Math.PI * r
    let html = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--line)" stroke-width="14"/>`
    let acc = 0
    const defs = segments.map((s, i) => {
      const d = { segLen: (s.value / total) * C, startAngle: -90 + acc * 360, col: s.color, idx: i }
      acc += s.value / total
      return d
    })
    defs.forEach(s => {
      html += `<circle id="seg${s.idx}" cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${s.col}" stroke-width="14" stroke-linecap="round" transform="rotate(${s.startAngle} ${cx} ${cy})"/>`
    })
    svg.innerHTML = html
    defs.forEach(s => {
      const el = svg.querySelector('#seg' + s.idx)
      el.style.strokeDasharray = s.segLen + ' ' + C
      if (reduce) { el.style.strokeDashoffset = 0; return }
      el.style.strokeDashoffset = s.segLen
      requestAnimationFrame(() => requestAnimationFrame(() => {
        el.style.transition = `stroke-dashoffset 1.1s var(--ease-entrance) ${s.idx * 0.18}s`
        el.style.strokeDashoffset = 0
      }))
    })
  }, [segments, total])

  if (total <= 0) {
    return <div className="chart-empty">No pipeline value yet.</div>
  }
  return <svg ref={svgRef} className="chart" viewBox="0 0 160 160" style={{ maxWidth: 160 }} />
}

/* ------------------------------------------------------------------ */
/* Gauge — single fraction arc (e.g. win rate).                        */
/* fraction: 0..1                                                       */
/* ------------------------------------------------------------------ */
export function Gauge({ fraction = 0 }) {
  const svgRef = useRef(null)
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const reduce = reduceMotion() || document.hidden
    const cx = 80, cy = 80, r = 58, C = 2 * Math.PI * r
    svg.innerHTML =
      `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--line)" stroke-width="14"/>` +
      `<circle id="gaugeArc" cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--cyan)" stroke-width="14" stroke-linecap="round" transform="rotate(-90 ${cx} ${cy})"/>`
    const arc = svg.querySelector('#gaugeArc')
    arc.style.strokeDasharray = C
    if (reduce) { arc.style.strokeDashoffset = C * (1 - fraction); return }
    arc.style.strokeDashoffset = C
    requestAnimationFrame(() => requestAnimationFrame(() => {
      arc.style.transition = 'stroke-dashoffset 1.2s var(--ease-entrance)'
      arc.style.strokeDashoffset = C * (1 - fraction)
    }))
  }, [fraction])
  return <svg ref={svgRef} className="chart" viewBox="0 0 160 160" style={{ maxWidth: 160 }} />
}
