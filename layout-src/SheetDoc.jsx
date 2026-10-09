/* ============================================================
   SheetDoc.jsx — the paginated, print-ready Building Approval Sheet
   (Approval Sheet mode + the PDF the CRM files under "Layout").

   Owner 10/6/26: "the layout is missing the lean-to . honestly this layout
   form thingy is cool but should look more like this one (2d spacing layout)".

   Page 1: StormSafe header, customer / site / quote no., spec band, finishes,
           a compact top-down PLAN (building + lean-tos to scale on their real
           walls, frame lines, partitions, every opening tagged) and the
           opening schedule.
   Then:   one ELEVATION per wall that has openings, drawn like the quote
           program's spacing page (thin outline, dashed frame lines at the
           real OC, dashed hatched openings with W×H, sill heights, a two-row
           dimension chain — gaps above, opening widths below — the overall
           length with the program's end names, the leg / eave height), 2–3
           per letter page with a small repeated header.
   Last:   the customer approval / signature block.

   Geometry is pure (sheetGeom.js, unit-tested); this file only draws.
   Bundled by scripts/build-layout.mjs (esbuild, bundle: true) → window.SheetDoc.
   ============================================================ */

import LOGO from './assets/logo-round.png'
import {
  FS, elevationSpecs, elevLayout, fmtFtIn, ltRect, ltOpeningPlan, trussFromFront, paginate,
  offsetFromFrameX, ltDrawToProg, snapAlong, wallSnapLines, ltWallLen, parseLtId, getLtOpening, setLtOpeningX, ltHighTxt, ltLowTxt, textW, peakTxt,
} from './sheetGeom.js'

const R = window.React

// Print-first palette (owner 10/6 evening: "white background is best ... easy to
// read"; it must survive a grayscale printer). Opening outlines by KIND — roll-ups
// the warm accent, walk doors / windows dark navy, frame-outs dark grey — and the
// kind is ALSO in the label (RU / WD / WN / FO ...) and the fill pattern (slats /
// mullions / knob / cross-hatch), never colour alone. No yellow.
const TYPE_HEX = {
  rollup: '#f0883e', walk: '#1A3556', double: '#1A3556', window: '#1A3556',
  sliding: '#166534', framed: '#374151', custom: '#374151',
}
const ROLE_HEX = { rollup: '#f0883e', walk: '#1A3556', window: '#1A3556', framed: '#374151' }
const KIND_ABBR = { rollup: 'RU', walk: 'WD', double: 'DD', window: 'WN', sliding: 'SD', framed: 'FO', custom: 'CF' }
const INK = '#111827', TXT = '#1f2937', LINE = '#374151', MUTED = '#4b5563', FRAME = '#9ca3af', TEAL = '#14A6A0', TEAL_D = '#0E7A76'
const CLR_C = '#B4531A' // CCI center clearance (the program's orange, darkened for print)
const FONT = 'Arial, Helvetica, sans-serif'
const kindOf = (it) => (TYPE_HEX[it.type] ? it.type : ({ wtd: 'walk', win: 'window', fo: 'framed' })[it.type] || it.role || 'framed')
const colorOf = (it) => TYPE_HEX[kindOf(it)] || LINE
// schedule tag ring colour for a layout opening type (Schedule.jsx reads it)
window.SheetPrintHex = TYPE_HEX
// a tag: white disc, coloured ring, near-black number — readable in grayscale
function Tag({ x, y, col, n, r = 10 }) {
  return (
    <g className="op-tag-mark">
      <circle cx={(+x).toFixed(1)} cy={(+y).toFixed(1)} r={r} fill="#ffffff" stroke={col} strokeWidth="2.4" />
      <text x={(+x).toFixed(1)} y={(+y + FS.tag * 0.36).toFixed(1)} textAnchor="middle" fontSize={FS.tag} fontWeight="700" fill={INK}>{n}</text>
    </g>
  )
}
// fill patterns per opening kind (+ the lean-to hatch)
function Patterns() {
  return (
    <defs>
      <pattern id="p-rollup" width="10" height="6" patternUnits="userSpaceOnUse"><line x1="0" y1="0.5" x2="10" y2="0.5" stroke="#f0883e" strokeOpacity="0.6" strokeWidth="1" /></pattern>
      <pattern id="p-window" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="#1A3556" strokeOpacity="0.22" strokeWidth="1" /></pattern>
      <pattern id="p-framed" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="7" stroke="#374151" strokeOpacity="0.3" strokeWidth="1" /><line x1="0" y1="0" x2="7" y2="0" stroke="#374151" strokeOpacity="0.3" strokeWidth="1" /></pattern>
      <pattern id="p-sliding" width="8" height="10" patternUnits="userSpaceOnUse"><line x1="0.5" y1="0" x2="0.5" y2="10" stroke="#166534" strokeOpacity="0.35" strokeWidth="1" /></pattern>
      <pattern id="h-lt" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="9" stroke="#0E7A76" strokeOpacity="0.16" strokeWidth="1" /></pattern>
    </defs>
  )
}
const PAT = { rollup: 'p-rollup', window: 'p-window', framed: 'p-framed', custom: 'p-framed', sliding: 'p-sliding' }

const PAGE_H = 1056, PAGE_PAD_B = 18, FOOT_H = 30
const CARD_W = 748

// ── top-down plan ──────────────────────────────────────────────────────────
// `ed` (Edit view only): { selectedId, onSelect, onMove(id, patch), onMoveLt(ref, x),
// placeType, onPlace(wall, offset), showFrames } — drag / snap / place on the plan.
function PlanKey({ building, openings, tagMap, geom, ed }) {
  const svgRef = R.useRef(null)
  const dragRef = R.useRef(null)
  const [guide, setGuide] = R.useState(null)
  const W = Number(building.width) || 0, L = Number(building.length) || 0
  const g = geom && geom.W === W && geom.L === L ? geom : null
  const lts = g && Array.isArray(g.leanTos) ? g.leanTos : []
  const ext = { left: 0, right: 0, front: 0, back: 0 }
  lts.forEach((l) => { ext[l.k] = Math.max(ext[l.k], l.w) })
  const zSpan = L + ext.front + ext.back, xSpan = W + ext.left + ext.right
  const VW = CARD_W, mL = 70, mR = 70, mT = 48, mB = 54
  const s = Math.min((VW - mL - mR) / (zSpan || 1), 250 / (xSpan || 1))
  const oz = mL + ((VW - mL - mR) - zSpan * s) / 2 + ext.front * s
  const ox = mT + ext.left * s
  const VH = Math.round(mT + xSpan * s + mB)
  const PZ = (z) => +(oz + z * s).toFixed(1)
  const PX = (x) => +(ox + x * s).toFixed(1)
  const els = []
  const hybrid = building.config === 'hybrid', carport = building.config === 'carport'
  const open = (g && g.open) || {}
  const wallOpen = {
    front: carport || (hybrid ? building.openEnd === 'front' : !!open.front),
    back: carport || (hybrid ? building.openEnd === 'back' : !!open.back),
    left: carport || (!hybrid && !!open.left), right: carport || (!hybrid && !!open.right),
  }
  // building footprint (white)
  els.push(<rect key="bf" x={PZ(0)} y={PX(0)} width={(L * s).toFixed(1)} height={(W * s).toFixed(1)} fill="#ffffff" stroke="none" />)
  // frame lines
  if (!ed || ed.showFrames !== false) trussFromFront(building, g).forEach((t, i) => els.push(
    <line key={'tr' + i} x1={PZ(t)} y1={PX(0)} x2={PZ(t)} y2={PX(W)} stroke={FRAME} strokeWidth="1" strokeDasharray="5 4" />))
  // lean-tos: white with a light teal hatch, teal dashed outline
  lts.forEach((l) => {
    const r = ltRect(l, W, L)
    const x = PZ(r.z0), y = PX(r.x0), w = (r.z1 - r.z0) * s, h = (r.x1 - r.x0) * s
    els.push(<rect key={'lt' + l.n} x={x} y={y} width={w.toFixed(1)} height={h.toFixed(1)} fill="url(#h-lt)" stroke={TEAL_D} strokeWidth="1.5" strokeDasharray={l.walls && l.walls.side === 'closed' ? null : '7 4'} />)
    if (l.stor) {
      const eave = l.k === 'left' || l.k === 'right'
      if (eave) els.push(<line key={'lts' + l.n} x1={PZ(l.stor.at)} y1={y} x2={PZ(l.stor.at)} y2={y + h} stroke={INK} strokeWidth="1.5" strokeDasharray="6 4" />)
      else { const d = l.k === 'back' ? W - l.stor.at : l.stor.at; els.push(<line key={'lts' + l.n} x1={x} y1={PX(d)} x2={x + w} y2={PX(d)} stroke={INK} strokeWidth="1.5" strokeDasharray="6 4" />) }
    }
    const full = `LT${l.n} · ${fmtFtIn(l.w)} × ${fmtFtIn(l.len)} · ${fmtFtIn(l.low)} low eave${l.stor ? ' · ' + fmtFtIn(l.stor.len) + ' storage (' + l.stor.end + ')' : ''}`
    const short = `LT${l.n}`
    // centred in the longest stretch the storage partition leaves (never across its line)
    let cxL = x + w / 2, cyL = y + h / 2, room = l.k === 'left' || l.k === 'right' ? w : h
    if (l.stor) {
      if (l.k === 'left' || l.k === 'right') { const a = PZ(l.stor.at); const pick = a - x >= x + w - a ? [x, a] : [a, x + w]; cxL = (pick[0] + pick[1]) / 2; room = pick[1] - pick[0] }
      else { const d = PX(l.k === 'back' ? W - l.stor.at : l.stor.at); const pick = d - y >= y + h - d ? [y, d] : [d, y + h]; cyL = (pick[0] + pick[1]) / 2 }
    }
    const cw = FS.lt * 0.58
    const fits = (l.k === 'left' || l.k === 'right') ? (full.length * cw < room - 12 && h >= FS.lt + 6) : (full.length * cw < w - 12 && h >= FS.lt + 6)
    els.push(<text key={'ltt' + l.n} x={cxL.toFixed(1)} y={(cyL + FS.lt * 0.36).toFixed(1)} textAnchor="middle" fontSize={FS.lt} fontWeight="700" fill={TEAL_D}>{fits ? full : short}</text>)
    // lean-to openings (the program's spots)
    ;(l.openings || []).forEach((o, oi) => {
      if (!Array.isArray(o.xs)) return
      o.xs.forEach((xx, i) => {
        const p = ltOpeningPlan(l, o.loc, xx, o.w, W, L)
        const id = `lt${l.n}-${oi}-${i}`
        if (ed && ed.selectedId === id) els.push(<line key={'lsel' + id} x1={PZ(p.z0)} y1={PX(p.x0)} x2={PZ(p.z1)} y2={PX(p.x1)} stroke={TEAL} strokeOpacity="0.4" strokeWidth="12" />)
        els.push(<line key={`lto${l.n}-${oi}-${i}`} x1={PZ(p.z0)} y1={PX(p.x0)} x2={PZ(p.z1)} y2={PX(p.x1)} stroke={ROLE_HEX[roleOf(o.type)]} strokeWidth="5" strokeLinecap="butt" data-op={id} />)
        if (ed) els.push(<line key={'lhit' + id} x1={PZ(p.z0)} y1={PX(p.x0)} x2={PZ(p.z1)} y2={PX(p.x1)} stroke="transparent" strokeWidth="16" className="op-hit" data-hit={id}
          onPointerDown={(e) => startLt(e, l, o, { n: l.n, oi, i }, xx)} />)
      })
    })
  })
  // partitions
  if (hybrid && window.hasDivider && window.hasDivider(building)) {
    const z = L - window.dividerLengthPos(building)
    els.push(<line key="div" x1={PZ(z)} y1={PX(0)} x2={PZ(z)} y2={PX(W)} stroke={INK} strokeWidth="1.8" strokeDasharray="7 4" />)
  }
  if (g && g.partition) {
    const p = g.partition
    if (p.kind === 'x') els.push(<line key="pt" x1={PZ(0)} y1={PX(p.at)} x2={PZ(L)} y2={PX(p.at)} stroke={INK} strokeWidth="1.6" strokeDasharray="7 4" />)
    else {
      els.push(<line key="pt" x1={PZ(p.at)} y1={PX(0)} x2={PZ(p.at)} y2={PX(W)} stroke={INK} strokeWidth="1.6" strokeDasharray="7 4" />)
      ;(p.items || []).forEach((it, i) => els.push(<line key={'pti' + i} x1={PZ(p.at) + 4} y1={PX(it.x)} x2={PZ(p.at) + 4} y2={PX(it.x + it.w)} stroke={ROLE_HEX[roleOf(it.type)]} strokeWidth="5" />))
    }
  }
  // walls: dark outline
  const WL = { front: [PZ(0), PX(0), PZ(0), PX(W)], back: [PZ(L), PX(0), PZ(L), PX(W)], left: [PZ(0), PX(0), PZ(L), PX(0)], right: [PZ(0), PX(W), PZ(L), PX(W)] }
  Object.keys(WL).forEach((k) => {
    const [a, b, c, d] = WL[k]
    els.push(<line key={'w' + k} x1={a} y1={b} x2={c} y2={d} stroke={INK} strokeWidth="2" strokeLinecap="square" strokeDasharray={wallOpen[k] ? '8 5' : null} />)
  })
  // main openings: a bar in the kind colour on the wall + its schedule tag outside
  const divZ = hybrid && window.dividerLengthPos ? L - window.dividerLengthPos(building) : null
  ;(openings || []).forEach((op) => {
    let seg, out
    const o = op.offset, w = op.w
    if (op.wall === 'front') { seg = [0, o, 0, o + w]; out = [-1, 0] }
    else if (op.wall === 'back') { seg = [L, o, L, o + w]; out = [1, 0] }
    else if (op.wall === 'left') { seg = [L - o - w, 0, L - o, 0]; out = [0, -1] }
    else if (op.wall === 'right') { seg = [L - o - w, W, L - o, W]; out = [0, 1] }
    else if (op.wall === 'divider' && divZ != null) { seg = [divZ, o, divZ, o + w]; out = [1, 0] }
    else return
    const col = TYPE_HEX[op.type] || LINE
    if (ed && ed.selectedId === op.id) els.push(<line key={'sel' + op.id} x1={PZ(seg[0])} y1={PX(seg[1])} x2={PZ(seg[2])} y2={PX(seg[3])} stroke={TEAL} strokeOpacity="0.4" strokeWidth="13" />)
    els.push(<line key={'op' + op.id} x1={PZ(seg[0])} y1={PX(seg[1])} x2={PZ(seg[2])} y2={PX(seg[3])} stroke={col} strokeWidth="6" data-op={op.id} />)
    if (ed) els.push(<line key={'hit' + op.id} x1={PZ(seg[0])} y1={PX(seg[1])} x2={PZ(seg[2])} y2={PX(seg[3])} stroke="transparent" strokeWidth="18" className="op-hit" data-hit={op.id}
      onPointerDown={(e) => startMain(e, op)} />)
    const tag = tagMap[op.id]
    if (tag) {
      // a lean-to on that side: the tag sits inside the building instead, clear of it
      const flip = (op.wall === 'left' && ext.left) || (op.wall === 'right' && ext.right) || (op.wall === 'front' && ext.front) || (op.wall === 'back' && ext.back)
      const d = flip ? -16 : 16
      els.push(<Tag key={'tg' + op.id} x={PZ((seg[0] + seg[2]) / 2) + out[0] * d} y={PX((seg[1] + seg[3]) / 2) + out[1] * d} col={col} n={tag} />)
    }
  })
  // names + overall sizes
  const lbl = (k, x, y, t, rot, anchor = 'middle') => els.push(
    <text key={k} x={x} y={y} textAnchor={anchor} fontSize="12" fontWeight="700" fill={LINE} letterSpacing=".1em" transform={rot ? `rotate(${rot} ${x} ${y})` : null}>{t}</text>)
  const nT = ext.left ? 12 : 34, nB = ext.right ? 22 : 44, nF = ext.front ? 16 : 38, nK = ext.back ? 18 : 40
  lbl('nl', (PZ(0) + PZ(L)) / 2, PX(-ext.left) - nT, `LEFT EAVE${ext.left ? ' SIDE' : ''} · ${fmtFtIn(L)}`)
  lbl('nr', (PZ(0) + PZ(L)) / 2, PX(W + ext.right) + nB, `RIGHT EAVE${ext.right ? ' SIDE' : ''} · ${fmtFtIn(L)}`)
  lbl('nf', PZ(-ext.front) - nF, (PX(0) + PX(W)) / 2, `FRONT · ${fmtFtIn(W)}`, -90)
  lbl('nb', PZ(L + ext.back) + nK, (PX(0) + PX(W)) / 2, `BACK · ${fmtFtIn(W)}`, 90)
  // ── editing ─────────────────────────────────────────────────────────────
  const allowed = ['front', 'back', 'left', 'right'].filter((w) => !(hybrid && w === building.openEnd))
  if (divZ != null && window.hasDivider && window.hasDivider(building)) allowed.push('divider')
  const WALLC = { front: ['v', PZ(0)], back: ['v', PZ(L)], left: ['h', PX(0)], right: ['h', PX(W)], divider: ['v', divZ != null ? PZ(divZ) : -1e9] }
  const wlen = (wall) => (wall === 'left' || wall === 'right' ? L : W)
  const toSvg = (e) => {
    const svg = svgRef.current; if (!svg) return null
    const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY
    const m = svg.getScreenCTM(); return m ? pt.matrixTransform(m.inverse()) : null
  }
  // the wall the pointer is nearest + the opening's raw offset there (WALLS.ref frame)
  const nearest = (p, w) => {
    let best = null
    allowed.forEach((wall) => { const [o, c] = WALLC[wall]; const d = Math.abs((o === 'v' ? p.x : p.y) - c); if (!best || d < best.d) best = { wall, d, o } })
    if (!best) return null
    const along = best.o === 'v' ? (p.y - ox) / s : (p.x - oz) / s // ft from the left eave / from the front
    return { wall: best.wall, off: best.o === 'v' ? along - w / 2 : L - along - w / 2 }
  }
  const snapMain = (wall, raw, w, selfId, free) => {
    const others = (openings || []).filter((o) => o.wall === wall && o.id !== selfId).map((o) => ({ x: o.offset, w: o.w }))
    const centers = wall === 'left' || wall === 'right' ? trussFromFront(building, g).map((t) => L - t) : []
    return snapAlong(raw, w, wlen(wall), { lines: wallSnapLines(wlen(wall), others), centerLines: centers, snap: 7 / s, free })
  }
  function startMain(e, op) {
    if (ed.placeType) return
    e.stopPropagation(); e.preventDefault()
    try { window.focus() } catch (_) { /* arrow keys reach this frame even when the drag is its first click */ }
    if (ed.onSelect) ed.onSelect(op.id)
    dragRef.current = { kind: 'main', id: op.id, w: op.w }
    try { svgRef.current.setPointerCapture(e.pointerId) } catch (_) { /* ignore */ }
  }
  function startLt(e, l, o, ref, x0) {
    if (ed.placeType) return
    e.stopPropagation(); e.preventDefault()
    try { window.focus() } catch (_) { /* arrow keys reach this frame even when the drag is its first click */ }
    if (ed.onSelect) ed.onSelect(`lt${ref.n}-${ref.oi}-${ref.i}`)
    const p = toSvg(e); if (!p) return
    const a = ltOpeningPlan(l, o.loc, 0, o.w, W, L), b = ltOpeningPlan(l, o.loc, 1, o.w, W, L)
    const axis = a.z0 !== b.z0 ? 'z' : 'x', sign = axis === 'z' ? b.z0 - a.z0 : b.x0 - a.x0
    const others = o.xs.filter((_, k) => k !== ref.i).map((x) => ({ x, w: o.w }))
      .concat((l.openings || []).filter((q, qi) => qi !== ref.oi && q.loc === o.loc && Array.isArray(q.xs)).flatMap((q) => q.xs.map((x) => ({ x, w: q.w }))))
    dragRef.current = { kind: 'lt', ref, l, o, axis, sign, p0: p, x0, others }
    try { svgRef.current.setPointerCapture(e.pointerId) } catch (_) { /* ignore */ }
  }
  function onMove(e) {
    const d = dragRef.current; if (!d) return
    const p = toSvg(e); if (!p) return
    if (d.kind === 'main') {
      const nw = nearest(p, d.w); if (!nw) return
      const r = snapMain(nw.wall, nw.off, d.w, d.id, e.altKey)
      setGuide(r.guide != null ? { wall: nw.wall, at: r.guide } : null)
      ed.onMove(d.id, { wall: nw.wall, offset: r.x })
    } else {
      const delta = ((d.axis === 'z' ? p.x - d.p0.x : p.y - d.p0.y) / s) * d.sign
      const len = ltWallLen(d.l, d.o.loc)
      const r = snapAlong(d.x0 + delta, d.o.w, len, { lines: wallSnapLines(len, d.others), snap: 7 / s, free: e.altKey })
      ed.onMoveLt(d.ref, r.x)
    }
  }
  function onUp(e) {
    if (dragRef.current) { try { svgRef.current.releasePointerCapture(e.pointerId) } catch (_) { /* ignore */ } }
    dragRef.current = null; setGuide(null)
  }
  function onDown(e) {
    if (!ed.placeType) return
    const def = window.OPENING_TYPES[ed.placeType]; const p = toSvg(e); if (!p || !def) return
    const nw = nearest(p, def.w); if (!nw) return
    ed.onPlace(nw.wall, snapMain(nw.wall, nw.off, def.w, null, e.altKey).x)
  }
  if (ed && guide) {
    const [o, c] = WALLC[guide.wall]
    const pos = o === 'v' ? PX(guide.at) : PZ(L - guide.at)
    els.push(o === 'v'
      ? <line key="guide" x1={c - 16} y1={pos} x2={c + 16} y2={pos} stroke={TEAL} strokeWidth="1.2" strokeDasharray="3 2" />
      : <line key="guide" x1={pos} y1={c - 16} x2={pos} y2={c + 16} stroke={TEAL} strokeWidth="1.2" strokeDasharray="3 2" />)
  }
  return (
    <svg ref={svgRef} className={'plan-key' + (ed ? ' is-edit' : '') + (ed && ed.placeType ? ' is-placing' : '')} viewBox={`0 0 ${VW} ${VH}`} width={VW} height={VH} xmlns="http://www.w3.org/2000/svg" fontFamily={FONT}
      onPointerMove={ed ? onMove : undefined} onPointerUp={ed ? onUp : undefined} onPointerCancel={ed ? onUp : undefined} onPointerDown={ed ? onDown : undefined}>
      <Patterns />
      {els}
    </svg>
  )
}
function roleOf(t) { return t === 'rollup' ? 'rollup' : t === 'wtd' ? 'walk' : t === 'win' ? 'window' : 'framed' }

// ── one elevation ──────────────────────────────────────────────────────────
// `ed` (Edit view only): drag an opening along this wall (snaps to the wall
// ends / centre / 5′ grid / neighbours, its centre to frame lines; Alt = free),
// click to select, click the wall to place the armed type. W, L = building size.
function ElevationCard({ spec, ed, W, L }) {
  const svgRef = R.useRef(null)
  const dragRef = R.useRef(null)
  const [guide, setGuide] = R.useState(null)
  const lay = elevLayout(spec)
  const { X, Y, gy, dy, dy2, VW, VH, s } = lay
  const els = []
  const F = spec.faceW
  const P = (arr) => arr.map(([x, h]) => `${X(x).toFixed(1)},${Y(h).toFixed(1)}`).join(' ')
  // ground line
  els.push(<line key="gnd" x1="8" y1={gy} x2={VW - 8} y2={gy} stroke={LINE} strokeWidth="1.2" />)
  // lean-tos end-on beside this wall: white, light teal hatch, teal dashed outline
  ;(spec.side || []).forEach((q, i) => {
    const pts = q.onLeft ? [[-q.w, 0], [-q.w, q.low], [0, q.conn], [0, 0]] : [[F, 0], [F, q.conn], [F + q.w, q.low], [F + q.w, 0]]
    els.push(<polygon key={'sl' + i} points={P(pts)} fill="url(#h-lt)" stroke={TEAL_D} strokeWidth="1.4" strokeDasharray="6 4" />)
    const nY = Math.min(Y(0) - 4, Math.max(Y(q.low * 0.3) + 5, Y(q.low * 0.72) + FS.lt + 11)) // under its "LTn high" label
    els.push(<text key={'slt' + i} x={X(q.onLeft ? -q.w / 2 : F + q.w / 2)} y={nY} textAnchor="middle" fontSize={FS.lt} fontWeight="700" fill={TEAL_D}>{q.label}</text>)
  })
  // the wall: white, dark outline
  const pts = [[0, 0], [0, spec.h(0)]]
  if (spec.gable) pts.push([F / 2, spec.h(F / 2)])
  pts.push([F, spec.h(F)], [F, 0])
  els.push(<polygon key="wall" points={P(pts)} fill="#ffffff" stroke={INK} strokeWidth="1.9" strokeLinejoin="round" strokeDasharray={spec.open ? '8 5' : null} />)
  if (spec.gable) els.push(<line key="eave" x1={X(0)} y1={Y(spec.eave)} x2={X(F)} y2={Y(spec.eave)} stroke={FRAME} strokeWidth="1" strokeDasharray="5 4" />)
  if (spec.open) els.push(<text key="ow" x={X(F / 2)} y={Y(spec.eave) + FS.frame + 6} textAnchor="middle" fontSize={FS.frame} fontWeight="600" fill={MUTED}>open wall</text>)
  // frame lines at the real OC (mid grey dashed — still prints)
  ;(spec.truss || []).forEach((t, i) => {
    if (t <= 1e-6 || t >= F - 1e-6) return
    els.push(<line key={'fl' + i} x1={X(t)} y1={gy} x2={X(t)} y2={Y(spec.h(t))} stroke={FRAME} strokeWidth="1" strokeDasharray="5 4" />)
  })
  if ((spec.truss || []).length && spec.oc) els.push(<text key="flt" x={X(F)} y={Y(spec.h(F)) - 10} textAnchor="end" fontSize={FS.frame} fontWeight="600" fill={LINE}>{`frame lines ${fmtFtIn(spec.oc)} OC`}</text>)
  // lean-to storage partition on its outer wall
  if (spec.storX != null) {
    els.push(<line key="st" x1={X(spec.storX)} y1={gy} x2={X(spec.storX)} y2={Y(spec.eave)} stroke={INK} strokeWidth="1.6" strokeDasharray="6 4" />)
    els.push(<text key="stt" x={X(spec.storX) + 5} y={Y(spec.eave) + FS.frame + 5} fontSize={FS.frame} fontWeight="700" fill={TEAL_D}>storage partition</text>)
  }
  // W×H label (with the kind: RU / WD / WN / FO ...) inside the opening when it
  // fits there, else just above it — never under the tag
  const labOf = (it) => `${KIND_ABBR[kindOf(it)] || ''} ${fmtFtIn(it.w)}×${fmtFtIn(it.h)}`.trim()
  const sizeLabelY = (it, ry, rw, rh) => {
    const lw = labOf(it).length * FS.size * 0.56
    return rh >= FS.size + 16 && rw >= lw + 8 ? ry + FS.size + 4 : ry - 7
  }
  // every W×H label gets a spot that touches no other label: inside the opening when it
  // fits, else above it, stepping further up when a neighbour's label is already there
  const labelY = {}
  {
    const placed = []
    const hit = (b) => placed.some((q) => b.x0 < q.x1 + 4 && b.x1 > q.x0 - 4 && b.y0 < q.y1 && b.y1 > q.y0)
    spec.items.slice().sort((a, b) => a.x - b.x).forEach((it) => {
      const rx = X(it.x), ry = Y(it.sill + it.h), rw = it.w * s, rh = it.h * s
      const lw = labOf(it).length * FS.size * 0.56, cx = rx + rw / 2
      const first = sizeLabelY(it, ry, rw, rh)
      const tries = [first].concat(first > ry ? [ry - 7] : []).concat([1, 2, 3, 4].map((k) => ry - 7 - k * (FS.size + 3)))
      let y = tries.find((t) => !hit({ x0: cx - lw / 2, x1: cx + lw / 2, y0: t - FS.size, y1: t + 3 }))
      if (y == null) y = tries[tries.length - 1]
      placed.push({ x0: cx - lw / 2, x1: cx + lw / 2, y0: y - FS.size, y1: y + 3 })
      labelY[it.id] = y
    })
  }
  // a lean-to hanging off this wall: its label never sits on an opening or an
  // opening's labels — above the footprint, else inside it at the bottom / top,
  // else just "LTn" there and the full text in the card's legend line
  const legend = []
  const busy = spec.items.flatMap((it) => {
    const rx = X(it.x), ry = Y(it.sill + it.h), rw = it.w * s, rh = it.h * s
    const lw = labOf(it).length * FS.size * 0.6
    const ly = labelY[it.id]
    return [{ x0: rx - 26, x1: rx + rw, y0: ry, y1: ry + rh }, { x0: rx + rw / 2 - lw / 2, x1: rx + rw / 2 + lw / 2, y0: ly - FS.size, y1: ly + 3 }]
  })
  if ((spec.truss || []).length && spec.oc) busy.push({ x0: X(F) - 170, x1: X(F), y0: Y(spec.h(F)) - 26, y1: Y(spec.h(F)) - 4 })
  // CCI center clearance (the program's figure, same as the spacing page): dashed line across the interior
  const ccTxt = spec.gable && spec.clr ? `Center clearance ≈ ${fmtFtIn(spec.clr.center)}` : null
  const ccY = ccTxt ? Y(Math.min(spec.clr.center, spec.peak)) : null
  if (ccTxt) { const w = textW(ccTxt, FS.frame) / 2 + 4; busy.push({ x0: X(F / 2) - w, x1: X(F / 2) + w, y0: ccY, y1: ccY + FS.frame + 6 }) }
  const clear = (b) => busy.every((q) => b.x1 <= q.x0 || b.x0 >= q.x1 || b.y1 <= q.y0 || b.y0 >= q.y1)
  // lean-tos end-on (owner 10/9/26): the main leg is dimensioned ON the main wall
  // corner ("Main 16′ leg" — never out past a lean-to); each lean-to gets its own
  // HIGH height at the attachment and LOW height at its outer post (the program's
  // own values: conn / low eave), lean-to teal like the lean-to itself
  const hR = spec.h(F), legTxt = lay.hl.leg
  const ltDims = []
  const vdim = (key, xx, h, col) => (<g key={key}>
    <line x1={xx} y1={Y(0)} x2={xx} y2={Y(h)} stroke={col} strokeWidth="1.3" />
    <line x1={xx - 6} y1={Y(0)} x2={xx + 6} y2={Y(0)} stroke={col} strokeWidth="1.3" />
    <line x1={xx - 6} y1={Y(h)} x2={xx + 6} y2={Y(h)} stroke={col} strokeWidth="1.3" />
  </g>)
  ;[lay.sideL, lay.sideR].forEach((arr) => arr.slice().sort((a, b) => a.w - b.w).forEach((q, k) => {
    const lf = q.onLeft, sg = lf ? -1 : 1, xh = lf ? X(0) - 9 : X(F) + 9, xl = lf ? X(-q.w) - 12 : X(F + q.w) + 12
    const ht = ltHighTxt(q), htw = textW(ht, FS.lt), inner = lf ? X(-q.w) + 3 : X(F + q.w) - 3
    let hx = xh + sg * 6, hy = Y(q.low * 0.72) + 5 + k * (FS.lt + 3)
    if (lf ? hx - htw < inner : hx + htw > inner) { hx = lf ? X(0) - 5 : X(F) + 5; hy = Y(q.conn) - 8 - k * (FS.lt + 3) } // too narrow: over its roof at the junction
    const lt = ltLowTxt(q), ltw = textW(lt, FS.lt), lx = xl + sg * 7, ly = (Y(0) + Y(q.low)) / 2 + 5 + k * (FS.lt + 3)
    const anchor = lf ? 'end' : 'start'
    ltDims.push(vdim('lth' + q.n, xh, q.conn, TEAL_D), vdim('ltl' + q.n, xl, q.low, TEAL_D))
    ltDims.push(<text key={'lthT' + q.n} x={hx.toFixed(1)} y={hy.toFixed(1)} textAnchor={anchor} fontSize={FS.lt} fontWeight="700" fill={TEAL_D} className="lt-high">{ht}</text>)
    ltDims.push(<text key={'ltlT' + q.n} x={lx.toFixed(1)} y={ly.toFixed(1)} textAnchor={anchor} fontSize={FS.lt} fontWeight="700" fill={TEAL_D} className="lt-low">{lt}</text>)
    busy.push(lf ? { x0: hx - htw * 1.15, x1: hx, y0: hy - FS.lt - 2, y1: hy + 5 } : { x0: hx, x1: hx + htw * 1.15, y0: hy - FS.lt - 2, y1: hy + 5 },
      lf ? { x0: lx - ltw, x1: lx, y0: ly - FS.lt, y1: ly + 3 } : { x0: lx, x1: lx + ltw, y0: ly - FS.lt, y1: ly + 3 })
  }))
  // the main leg: right of the wall, or — with a lean-to on the right — ON the
  // main wall corner (the junction), label inside the main wall at the first
  // height clear of every opening / sill / lean-to label; a crowded wall puts it
  // just above that lean-to's roof, beside the junction line
  let dx = X(F + lay.extR) + 18, legLab = null
  if (lay.sideR.length) {
    dx = X(F) - 9
    const lw = textW(legTxt, FS.leg) * 1.05
    const sills = spec.items.filter((it) => it.sill > 0.1).map((it) => { const cx = X(it.x + it.w / 2), w = textW(`sill ${fmtFtIn(it.sill)}`, FS.sill) / 2 + 3, y = (Y(0) + Y(it.sill)) / 2 + 5; return { x0: cx - w, x1: cx + w, y0: y - FS.sill, y1: y + 4 } }) // the sill labels too
    // the opening W×H labels with real bold-glyph widths (busy's estimate runs narrow for ′ ″ ×)
    const hard = sills.concat(spec.items.map((it) => { const cx = X(it.x + it.w / 2), w = labOf(it).length * FS.size * 0.42 + 4, y = labelY[it.id]; return { x0: cx - w, x1: cx + w, y0: y - FS.size - 2, y1: y + 5 } }))
    const free = (b) => clear(b) && hard.every((q) => b.x1 <= q.x0 || b.x0 >= q.x1 || b.y1 <= q.y0 || b.y0 >= q.y1)
    for (const fr of [0.5, 0.62, 0.38, 0.75, 0.25].concat(Array.from({ length: 37 }, (_, i) => 0.95 - i * 0.025))) {
      const y = Y(hR * fr) + 5, b = { x0: dx - 7 - lw, x1: dx + 2, y0: y - FS.leg - 2, y1: y + 5 }
      if (b.x0 >= X(0) + 2 && free(b)) { legLab = { x: dx - 7, y, a: 'end', b }; break }
    }
    const top = lay.sideR.reduce((m, q) => Math.max(m, q.conn), 0)
    if (!legLab) { // between the main eave and the lean-to roof, top down, else just over the eave height
      const ys = []
      for (let y = Y(hR) + FS.leg; y <= Y(top) - 4; y += 3) ys.push(y)
      ys.push(Y(hR) - 6)
      for (const y of ys) { const b = { x0: X(F) + 4, x1: X(F) + 6 + lw, y0: y - FS.leg - 2, y1: y + 5 }; if (b.x1 <= VW - 2 && free(b)) { legLab = { x: X(F) + 5, y, a: 'start', b }; break } }
    }
    if (!legLab) { const y = Y(hR * 0.5) + 5; legLab = { x: dx - 7, y, a: 'end', b: { x0: dx - 7 - lw, x1: dx + 2, y0: y - FS.leg, y1: y + 4 } } }
    busy.push(legLab.b, { x0: dx - 6, x1: dx + 6, y0: Y(hR), y1: Y(0) })
  }
  ;(spec.foot || []).forEach((f, i) => {
    els.push(<rect key={'ft' + i} x={X(f.x0)} y={Y(f.h)} width={(f.len * s).toFixed(1)} height={(f.h * s).toFixed(1)} fill="url(#h-lt)" stroke={TEAL_D} strokeWidth="1.4" strokeDasharray="7 5" />)
    const spots = [Y(f.h) - 7, Y(0) - 8, Y(f.h) + FS.lt + 5]
    const tryText = (txt) => {
      const tw = txt.length * FS.lt * 0.58
      if (tw > f.len * s - 10) return null
      for (const y of spots) { const b = { x0: X(f.x0) + 6, x1: X(f.x0) + 6 + tw, y0: y - FS.lt, y1: y + 3 }; if (clear(b)) { busy.push(b); return y } }
      return null
    }
    let txt = f.label, y = tryText(txt)
    if (y == null) { txt = f.label.split(' · ')[0]; y = tryText(txt); legend.push(f.label) }
    if (y == null) y = Y(f.h) - 7
    els.push(<text key={'ftt' + i} x={X(f.x0) + 6} y={y} fontSize={FS.lt} fontWeight="700" fill={TEAL_D}>{txt}</text>)
  })
  // openings: SOLID outline in the kind colour + the kind's pattern / marks,
  // the kind + W×H, the sill, the schedule tag
  const items = spec.items.slice().sort((a, b) => a.x - b.x)
  items.forEach((it) => {
    const k = kindOf(it), col = colorOf(it)
    const rx = X(it.x), ry = Y(it.sill + it.h), rw = it.w * s, rh = it.h * s
    const movable = !!ed && (spec.wall ? true : !!it.lt)
    if (ed && ed.selectedId === it.id) els.push(<rect key={'sel' + it.id} x={(rx - 4).toFixed(1)} y={(ry - 4).toFixed(1)} width={(rw + 8).toFixed(1)} height={(rh + 8).toFixed(1)} fill="none" stroke={TEAL} strokeOpacity="0.6" strokeWidth="3" />)
    els.push(<rect key={'o' + it.id} x={rx.toFixed(1)} y={ry.toFixed(1)} width={rw.toFixed(1)} height={rh.toFixed(1)} fill={PAT[k] ? `url(#${PAT[k]})` : '#ffffff'} stroke={col} strokeWidth="2" data-op={it.id} data-kind={k}
      className={movable ? 'op-hit' : undefined} onPointerDown={movable ? (e) => startDrag(e, it) : undefined} />)
    if (k === 'window') {
      els.push(<line key={'wm1' + it.id} x1={(rx + rw / 2).toFixed(1)} y1={ry.toFixed(1)} x2={(rx + rw / 2).toFixed(1)} y2={(ry + rh).toFixed(1)} stroke={col} strokeWidth="1" />)
      els.push(<line key={'wm2' + it.id} x1={rx.toFixed(1)} y1={(ry + rh / 2).toFixed(1)} x2={(rx + rw).toFixed(1)} y2={(ry + rh / 2).toFixed(1)} stroke={col} strokeWidth="1" />)
    }
    if (k === 'walk' || k === 'double') {
      if (k === 'double') els.push(<line key={'dd' + it.id} x1={(rx + rw / 2).toFixed(1)} y1={ry.toFixed(1)} x2={(rx + rw / 2).toFixed(1)} y2={(ry + rh).toFixed(1)} stroke={col} strokeWidth="1.2" />)
      els.push(<circle key={'kn' + it.id} cx={(rx + rw * (k === 'double' ? 0.42 : 0.8)).toFixed(1)} cy={(ry + rh * 0.55).toFixed(1)} r={Math.max(2.4, s * 0.13).toFixed(1)} fill={col} />)
    }
    const ly = labelY[it.id]
    els.push(<text key={'ol' + it.id} x={(rx + rw / 2).toFixed(1)} y={ly.toFixed(1)} textAnchor="middle" fontSize={FS.size} fontWeight="700" fill={INK} className="op-size">{labOf(it)}</text>)
    if (it.sill > 0.1) els.push(<text key={'os' + it.id} x={(rx + rw / 2).toFixed(1)} y={((Y(0) + Y(it.sill)) / 2 + 5).toFixed(1)} textAnchor="middle" fontSize={FS.sill} fontWeight="600" fill={TXT} className="op-sill">{`sill ${fmtFtIn(it.sill)}`}</text>)
    if (it.tag) els.push(<Tag key={'otg' + it.id} x={rx - 14} y={ry + Math.min(rh / 2, Math.max(rh - 11, 11))} col={col} n={it.tag} />)
  })
  // leg / eave height: right of the wall, or ON the main wall corner when a lean-to is there (hR / dx / legLab above)
  els.push(<g key="leg">
    <line x1={dx} y1={Y(0)} x2={dx} y2={Y(hR)} stroke={LINE} strokeWidth="1.3" />
    <line x1={dx - 6} y1={Y(0)} x2={dx + 6} y2={Y(0)} stroke={LINE} strokeWidth="1.3" />
    <line x1={dx - 6} y1={Y(hR)} x2={dx + 6} y2={Y(hR)} stroke={LINE} strokeWidth="1.3" />
    {legLab
      ? <text x={legLab.x} y={legLab.y} textAnchor={legLab.a} fontSize={FS.leg} fontWeight="700" fill={INK} className="leg-main">{legTxt}</text>
      : <text x={dx + 9} y={(Y(0) + Y(hR)) / 2 + 5} fontSize={FS.leg} fontWeight="700" fill={INK}>{legTxt}</text>}
  </g>)
  if (spec.sloped) els.push(<text key="h0" x={X(0) - 8} y={Y(spec.h(0)) + 5} textAnchor="end" fontSize={FS.leg} fontWeight="700" fill={INK}>{lay.hl.h0}</text>)
  els.push(...ltDims)
  if (spec.gable) {
    const pk = typeof spec.peak === 'number' ? spec.peak : 0
    els.push(<text key="pk" x={X(F / 2)} y={Y(pk) - 10} textAnchor="middle" fontSize={FS.peak} fontWeight="600" fill={TXT} className="peak">{peakTxt(spec)}</text>)
  }
  if (ccTxt) {
    els.push(<line key="cc" x1={X(0)} y1={ccY} x2={X(F)} y2={ccY} stroke={CLR_C} strokeWidth="1.2" strokeDasharray="6 4" />)
    els.push(<text key="cct" x={X(F / 2)} y={ccY + FS.frame + 3} textAnchor="middle" fontSize={FS.frame} fontWeight="600" fill={CLR_C} className="center-clr">{ccTxt}</text>)
  }
  // the chain: corner -> opening edges -> corner; gaps above the line, widths below
  if (lay.segs.length) {
    const a0 = lay.segs[0].a, a1 = lay.segs[lay.segs.length - 1].b
    els.push(<line key="ch" x1={X(a0 / 96)} y1={dy} x2={X(a1 / 96)} y2={dy} stroke={LINE} strokeWidth="1.3" />)
    const stops = Array.from(new Set(lay.segs.flatMap((sg) => [sg.a, sg.b])))
    stops.forEach((t) => els.push(<line key={'ck' + t} x1={X(t / 96)} y1={dy - 6} x2={X(t / 96)} y2={dy + 6} stroke={LINE} strokeWidth="1.3" />))
    lay.rows.forEach((r, i) => els.push(
      <text key={'cl' + i} x={r.cx.toFixed(1)} y={lay.rowY(r.row).toFixed(1)} textAnchor="middle" fontSize={FS.chain}
        fontWeight={r.kind === 'width' ? 700 : 500} fill={r.kind === 'width' ? INK : TXT}
        className={'ch-' + r.kind} data-e8={r.d}>{r.text}</text>))
  }
  // overall + end names; lean-tos end-on: "LT2 12′ | 30′ main | LT1 12′" on that line, the overall width under it
  const { wL, wR, dy3 } = lay
  const ltName = (arr, w) => arr.filter((q) => q.w === w).map((q) => q.label).join('/')
  const mainTxt = dy3 != null ? `${fmtFtIn(F)} main` : fmtFtIn(F), mainBox = Math.max(84, textW(mainTxt, FS.total) + 14)
  if (dy3 != null) {
    const ovTxt = `${fmtFtIn(wL + F + wR)} overall`, ovBox = textW(ovTxt, FS.total) + 14, cx = X((F + wR - wL) / 2)
    els.push(<g key="ovlt">
      {wL > 0 && <line x1={X(-wL)} y1={dy2} x2={X(0)} y2={dy2} stroke={LINE} strokeWidth="1.3" />}
      {wL > 0 && <line x1={X(-wL)} y1={dy2 - 7} x2={X(-wL)} y2={dy2 + 7} stroke={LINE} strokeWidth="1.3" />}
      {wR > 0 && <line x1={X(F)} y1={dy2} x2={X(F + wR)} y2={dy2} stroke={LINE} strokeWidth="1.3" />}
      {wR > 0 && <line x1={X(F + wR)} y1={dy2 - 7} x2={X(F + wR)} y2={dy2 + 7} stroke={LINE} strokeWidth="1.3" />}
      {[[wL, -wL / 2, ltName(lay.sideL, wL)], [wR, F + wR / 2, ltName(lay.sideR, wR)]].filter((v) => v[0] > 0).map(([w, c, nm]) => {
        const t = `${nm} ${fmtFtIn(w)}`, bw = textW(t, FS.lt) + 12
        if (bw > w * s - 8) return <text key={'ltw' + nm} x={c < 0 ? X(0) - 4 : X(F) + 4} y={dy2 + FS.lt + 9} textAnchor={c < 0 ? 'end' : 'start'} fontSize={FS.lt} fontWeight="700" fill={TEAL_D} className="lt-width">{t}</text> // narrow: under its line
        return <g key={'ltw' + nm}><rect x={X(c) - bw / 2} y={dy2 - 11} width={bw} height="22" fill="#ffffff" />
          <text x={X(c)} y={dy2 + FS.lt * 0.36} textAnchor="middle" fontSize={FS.lt} fontWeight="700" fill={TEAL_D} className="lt-width">{t}</text></g>
      })}
      <line x1={X(-wL)} y1={dy3} x2={X(F + wR)} y2={dy3} stroke={LINE} strokeWidth="1.3" />
      <line x1={X(-wL)} y1={dy3 - 7} x2={X(-wL)} y2={dy3 + 7} stroke={LINE} strokeWidth="1.3" />
      <line x1={X(F + wR)} y1={dy3 - 7} x2={X(F + wR)} y2={dy3 + 7} stroke={LINE} strokeWidth="1.3" />
      <rect x={cx - ovBox / 2} y={dy3 - 12} width={ovBox} height="24" fill="#ffffff" />
      <text x={cx} y={dy3 + FS.total * 0.36} textAnchor="middle" fontSize={FS.total} fontWeight="700" fill={INK} className="ch-overall">{ovTxt}</text>
    </g>)
  }
  els.push(<g key="ov">
    <line x1={X(0)} y1={dy2} x2={X(F)} y2={dy2} stroke={LINE} strokeWidth="1.3" />
    <line x1={X(0)} y1={dy2 - 7} x2={X(0)} y2={dy2 + 7} stroke={LINE} strokeWidth="1.3" />
    <line x1={X(F)} y1={dy2 - 7} x2={X(F)} y2={dy2 + 7} stroke={LINE} strokeWidth="1.3" />
    <rect x={X(F / 2) - mainBox / 2} y={dy2 - 12} width={mainBox} height="24" fill="#ffffff" />
    <text x={X(F / 2)} y={dy2 + FS.total * 0.36} textAnchor="middle" fontSize={FS.total} fontWeight="700" fill={INK} className="ch-total">{mainTxt}</text>
    <text x={X(0)} y={dy2 + FS.end + 10} fontSize={FS.end} fontWeight="700" fill={LINE} letterSpacing=".1em">{spec.ends[0]}</text>
    <text x={X(F)} y={dy2 + FS.end + 10} textAnchor="end" fontSize={FS.end} fontWeight="700" fill={LINE} letterSpacing=".1em">{spec.ends[1]}</text>
  </g>)
  // ── editing ─────────────────────────────────────────────────────────────
  const toSvg = (e) => {
    const svg = svgRef.current; if (!svg) return null
    const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY
    const m = svg.getScreenCTM(); return m ? pt.matrixTransform(m.inverse()) : null
  }
  function startDrag(e, it) {
    if (!ed || ed.placeType) return
    e.stopPropagation(); e.preventDefault()
    try { window.focus() } catch (_) { /* arrow keys reach this frame even when the drag is its first click */ }
    if (ed.onSelect) ed.onSelect(it.id)
    const p = toSvg(e); if (!p) return
    dragRef.current = { it, p0: p, x0: it.x, others: items.filter((o) => o.id !== it.id) }
    try { svgRef.current.setPointerCapture(e.pointerId) } catch (_) { /* ignore */ }
  }
  function onMove(e) {
    const d = dragRef.current; if (!d) return
    const p = toSvg(e); if (!p) return
    const r = snapAlong(d.x0 + (p.x - d.p0.x) / s, d.it.w, F, { lines: wallSnapLines(F, d.others), centerLines: spec.truss || [], snap: 7 / s, free: e.altKey })
    setGuide(r.guide)
    if (d.it.lt) ed.onMoveLt(d.it.lt, ltDrawToProg(d.it.lt, r.x, d.it.w))
    else ed.onMove(d.it.id, { offset: offsetFromFrameX(spec.wall, r.x, d.it.w, W, L) })
  }
  function onUp(e) {
    if (dragRef.current) { try { svgRef.current.releasePointerCapture(e.pointerId) } catch (_) { /* ignore */ } }
    dragRef.current = null; setGuide(null)
  }
  function onDown(e) {
    if (!ed.placeType || !spec.wall) return
    const def = window.OPENING_TYPES[ed.placeType]; const p = toSvg(e); if (!p || !def) return
    const r = snapAlong((p.x - X(0)) / s - def.w / 2, def.w, F, { lines: wallSnapLines(F, items), centerLines: spec.truss || [], snap: 7 / s, free: e.altKey })
    ed.onPlace(spec.wall, offsetFromFrameX(spec.wall, r.x, def.w, W, L))
  }
  if (ed && guide != null) els.push(<line key="guide" x1={X(guide)} y1={gy + 6} x2={X(guide)} y2={Y(spec.h(guide)) - 6} stroke={TEAL} strokeWidth="1.2" strokeDasharray="3 2" />)
  return (
    <div className={'elev-card' + (ed ? ' is-edit' : '')} data-elev={spec.key}>
      <div className="elev-head">
        <span className="elev-title">{spec.title}</span>
        <span className="elev-sub">{spec.sub}</span>
        <span className="elev-meta">{`${items.length} opening${items.length === 1 ? '' : 's'}`}</span>
      </div>
      <svg ref={svgRef} className={'elev-svg' + (ed && ed.placeType && spec.wall ? ' is-placing' : '')} viewBox={`0 0 ${VW} ${VH}`} width={CARD_W} height={Math.round(VH * CARD_W / VW)} xmlns="http://www.w3.org/2000/svg" fontFamily={FONT}
        onPointerMove={ed ? onMove : undefined} onPointerUp={ed ? onUp : undefined} onPointerCancel={ed ? onUp : undefined} onPointerDown={ed ? onDown : undefined}>
        <Patterns />
        {els}
      </svg>
      {(spec.notes || []).concat(legend).length > 0 && <div className="elev-notes">{(spec.notes || []).concat(legend).map((n, i) => <div key={i}>{n}</div>)}</div>}
    </div>
  )
}

// ── the document (same family as the StormSafe Purchase Agreement PDF) ──────
// White page; round StormSafe logo + contact line top-left; the title top-right
// in heavy caps with quote no. / date / building under it; a black rule; section
// titles in bold tracked caps; boxed info blocks with light borders.
const CONTACT = '561-771-5555 • connect@stormsafesteel.com • stormsafesteel.com'
function longDate(d) {
  try { return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) } catch (e) { return '' }
}
function sizeText(b) { return `${fmtFtIn(Number(b.width) || 0)} × ${fmtFtIn(Number(b.length) || 0)} × ${fmtFtIn(Number(b.height) || 0)}` }
function DocHeader({ docInfo, building, revisionMode, compact, page, total }) {
  const has = (v) => v != null && String(v).trim() !== ''
  const date = has(docInfo.date) ? docInfo.date.trim() : longDate(new Date())
  return (
    <div className={'doc-hdr' + (compact ? ' compact' : '')}>
      <img className="doc-logo" src={LOGO} alt="StormSafe Steel" />
      <div className="doc-brand">
        <div className="doc-brand-name">STORM<span>SAFE</span> STEEL</div>
        <div className="doc-brand-contact">{CONTACT}</div>
      </div>
      <div className="doc-meta">
        <div className="doc-title">{revisionMode ? 'Revised Layout Approval' : 'Building Approval Sheet'}</div>
        {has(docInfo.quoteNo) && <div className="doc-sub"><strong className="mono">{docInfo.quoteNo}</strong>{has(docInfo.rev) ? <strong> · {docInfo.rev}</strong> : null}</div>}
        <div className="doc-sub">Date: <strong>{date}</strong></div>
        <div className="doc-sub">Building: <strong>{sizeText(building)}</strong>{compact && total ? <> · Page <strong>{page}</strong> of {total}</> : null}</div>
      </div>
    </div>
  )
}
function SecTitle({ children, hint }) {
  return <div className="doc-sec"><span className="doc-sec-t">{children}</span>{hint ? <span className="doc-sec-hint">{hint}</span> : null}</div>
}
function DocJob({ docInfo }) {
  const has = (v) => v != null && String(v).trim() !== ''
  return (
    <div className="doc-cards">
      <div className="doc-card">
        <div className="doc-card-t">Customer</div>
        <div className="doc-field"><span className="l">Name</span><span className="v">{has(docInfo.customer) ? docInfo.customer : '—'}</span></div>
        {has(docInfo.rep) && <div className="doc-field"><span className="l">Prepared by</span><span className="v">{docInfo.rep}</span></div>}
      </div>
      <div className="doc-card">
        <div className="doc-card-t">Jobsite</div>
        <div className="doc-field"><span className="l">Site addr</span><span className="v">{has(docInfo.address) ? docInfo.address : '—'}</span></div>
      </div>
    </div>
  )
}
function DocSpecs({ building, docInfo }) {
  const fin = docInfo.finishes || null
  const mfr = docInfo.mfr || window.DEFAULT_MFR
  const color = (key) => {
    const v = fin && fin[key]
    const named = v && window.catalogFor ? window.catalogFor(mfr).colors[v] : null
    return { name: named ? named.name : (v && v[0] === '#' ? v.toUpperCase() : '—'), sw: named ? window.colorSwatch(mfr, v) : (v && v[0] === '#' ? v : null) }
  }
  const cells = [
    ['Dimensions', `${fmtFtIn(Number(building.width) || 0)} × ${fmtFtIn(Number(building.length) || 0)}`],
    ['Eave / leg', fmtFtIn(Number(building.height) || 0)],
    ['Roof pitch', building.pitch || '—'],
    ['Wind rating', building.wind ? building.wind + ' MPH' : '—'],
    ['Trusses', (building.trussOC || '—') + '′ OC'],
    ['Framing', (window.GAUGES && window.GAUGES[building.gauge] ? window.GAUGES[building.gauge].label : building.gauge)],
    ['Columns', window.LEG_TYPES && window.LEG_TYPES[building.legType] ? window.LEG_TYPES[building.legType].label : '—'],
    ['Configuration', (window.CONFIG_LABEL && window.CONFIG_LABEL[building.config]) || '—' ,
      building.config === 'hybrid' ? `${fmtFtIn(Math.max(0, building.length - building.openLength))} enclosed · ${fmtFtIn(building.openLength)} open ${building.openEnd}` : null],
  ]
  const cols = fin ? [['Roof', 'roof'], ['Walls', 'walls'], ['Trim', 'trim']].concat(fin.hasWainscot ? [['Wainscot', 'wainscot']] : []) : []
  return (
    <div className="doc-specs">
      {cells.map(([l, v, sub]) => <div key={l} className="doc-spec"><div className="l">{l}</div><div className="v">{v}</div>{sub ? <div className="s">{sub}</div> : null}</div>)}
      {cols.map(([l, k]) => { const c = color(k); return <div key={l} className="doc-spec"><div className="l">{l} color</div><div className="v">{c.sw ? <span className="doc-sw" style={{ background: c.sw }} /> : null}{c.name}</div></div> })}
    </div>
  )
}
// how to read the drawings — kind codes + line styles (also in grayscale)
function KeyLine() {
  return (
    <div className="doc-key">
      <span><b>RU</b> roll-up door (slats)</span><span><b>WD</b> walk door (knob)</span><span><b>DD</b> double door</span>
      <span><b>WN</b> window (mullions)</span><span><b>FO</b> framed opening (cross-hatch)</span>
      <span><i className="k-lt" /> lean-to (teal dashed)</span><span><i className="k-fl" /> frame line</span>
    </div>
  )
}
function PageFoot({ docInfo, page, total }) {
  return (
    <div className="page-foot">
      <span><b>StormSafe Steel</b>{docInfo.quoteNo ? ' · ' + docInfo.quoteNo : ''}{docInfo.customer ? ' · ' + docInfo.customer : ''}</span>
      <span className="pf-mid">Dimensions to the opening edge, from the wall corners · feet-inches to the nearest 1/8 inch</span>
      <span>Page {page} of {total}</span>
    </div>
  )
}

function SheetDoc(props) {
  const { building, docInfo, openings, tagMap, revisionMode } = props
  const geom = docInfo && docInfo.geom ? docInfo.geom : null
  const specs = elevationSpecs(building, openings, geom, tagMap)
  const sizeMismatch = geom && (geom.W !== Number(building.width) || geom.L !== Number(building.length))
  const notesB = { ...building, notes: (building.notes || []).concat(sizeMismatch ? ['The quote’s lean-tos / partitions are not drawn: the building size was changed here from the quote’s ' + fmtFtIn(geom.W) + ' × ' + fmtFtIn(geom.L) + '.'] : []) }
  // every lean-to spelled out under the plan (the plan label may be just "LTn")
  const planLegend = (geom && !sizeMismatch && Array.isArray(geom.leanTos) ? geom.leanTos : []).map(ltLegend)
  const stageRef = R.useRef(null)
  const [plan, setPlan] = R.useState(null)
  const H = window.SheetParts
  const cards = specs.map((sp) => <ElevationCard key={sp.key} spec={sp} />)
  const sign = <div className="sign-block"><SecTitle>Customer Approval</SecTitle>{revisionMode && H.RevChanges()}{H.SignOff({ revisionMode })}</div>
  const p1Core = (sched) => (
    <>
      <DocHeader docInfo={docInfo} building={building} revisionMode={revisionMode} />
      <DocJob docInfo={docInfo} />
      {revisionMode && H.RevStrip()}
      <SecTitle>Building Specifications</SecTitle>
      <DocSpecs building={building} docInfo={docInfo} />
      <SecTitle hint="Top view · lean-tos, frame lines and openings to scale · tags match the schedule">Building Plan</SecTitle>
      <div className="plan-key-wrap"><PlanKey building={building} openings={openings} tagMap={tagMap} geom={geom} />
        {planLegend.length > 0 && <div className="plan-legend">{planLegend.map((t, i) => <span key={i}>{t}</span>)}</div>}</div>
      {sched != null && <SecTitle hint={specs.length ? 'Wall elevations follow · tags match the plan' : 'Tags match the plan'}>Opening Schedule</SecTitle>}
      {sched}
    </>
  )

  const schedFull = <window.Schedule building={notesB} openings={openings} tagMap={tagMap} />
  const schedBare = <window.Schedule building={{ ...notesB, notes: [] }} openings={openings} tagMap={tagMap} />
  const notesBlock = notesB.notes && notesB.notes.length ? (
    <div className="notes-block"><SecTitle hint="Continued from page 1">Quote Notes</SecTitle>
      <table className="sched"><tbody className="sched-notes">{notesB.notes.map((n, i) => <tr key={i}><td>{n}</td></tr>)}</tbody></table></div>) : null
  const elevHead = <><SecTitle hint="Each wall seen from outside · chain: gaps above the line, opening widths below">Wall Elevations</SecTitle><KeyLine /></>

  // Measure (off-screen staging copy) → decide pages. Runs before paint.
  const sig = JSON.stringify([specs.map((s) => [s.key, s.items.length]), openings.length, notesB.notes, revisionMode, docInfo.customer, docInfo.address, docInfo.quoteNo, building.width, building.length])
  R.useLayoutEffect(() => {
    const st = stageRef.current
    if (!st) return
    const hOf = (sel) => { const el = st.querySelector(sel); return el ? el.getBoundingClientRect().height : 0 }
    const avail1 = PAGE_H - PAGE_PAD_B - FOOT_H - 14
    const top = hOf('[data-stage="p1top"]')
    const schedH = hOf('[data-stage="sched"]')
    const notesH = hOf('[data-stage="notes"]'), notesRowsH = notesH - hOf('[data-stage="notes"] .doc-sec')
    const signH = hOf('[data-stage="sign"]') + 12
    const hasNotes = !!(notesB.notes && notesB.notes.length)
    // page 1 = header, specs, plan, then the schedule if it fits (else the schedule opens page 2)
    const schedOnP1 = top + schedH <= avail1
    const core = schedOnP1 ? top + schedH : top
    const notesOnP1 = !hasNotes || !schedOnP1 || core + notesRowsH <= avail1
    const p1Room = avail1 - core - (hasNotes && schedOnP1 && notesOnP1 ? notesRowsH : 0)
    const headH = hOf('[data-stage="mini"]')
    const eheadH = hOf('[data-stage="ehead"]')
    const availN = PAGE_H - 30 - PAGE_PAD_B - FOOT_H - headH // page top padding 30; staged heights include each block's margins (no page may overflow)
    // blocks for the elevation pages: the quote notes first when page 1 can't hold them, then the
    // "Wall Elevations" title + key once, then the cards (height decides how many share a page)
    const ids = [...(schedOnP1 ? [] : ['sched']), ...(notesOnP1 ? [] : ['notes']), ...(specs.length ? ['ehead'] : []), ...specs.map((_, i) => i)]
    const heights = ids.map((b) => (b === 'sched' ? hOf('[data-stage="schedfull"]') + 12 : b === 'notes' ? notesH : b === 'ehead' ? eheadH : hOf(`[data-stage="e-${specs[b].key}"]`)))
    // the 'Wall Elevations' title + key never sit alone at a page bottom: they travel with the first card
    const eI = ids.indexOf('ehead')
    if (eI >= 0 && eI + 1 < heights.length) { heights[eI] += heights[eI + 1]; heights[eI + 1] = 0 }
    const pg = paginate(heights, availN, signH, 4, p1Room)
    const next = { schedOnP1, notesOnP1, signOnP1: pg.signOnP1, pages: pg.pages.map((p) => p.map((i) => (i === 'sign' ? 'sign' : ids[i]))) }
    const k = JSON.stringify(next)
    if (!plan || plan.k !== k || plan.sig !== sig) setPlan({ ...next, k, sig })
  })

  const ready = plan && plan.sig === sig
  const pages = ready ? plan.pages : []
  const total = 1 + pages.length
  return (
    <>
      <div className="sheet-doc doc-print">
        <div className="sheet sheet-page p1 doc-print">
          {p1Core(ready && !plan.schedOnP1 ? null : (ready && !plan.notesOnP1 ? schedBare : schedFull))}
          {ready && plan.signOnP1 && sign}
          <div className="page-fill" />
          <PageFoot docInfo={docInfo} page={1} total={total} />
        </div>
        {pages.map((blk, pi) => (
          <div key={pi} className="sheet sheet-page pn doc-print">
            <DocHeader docInfo={docInfo} building={building} revisionMode={revisionMode} compact page={pi + 2} total={total} />
            {blk.map((b) => b === 'sign' ? <R.Fragment key="sign">{sign}</R.Fragment> : b === 'notes' ? <R.Fragment key="notes">{notesBlock}</R.Fragment> : b === 'sched' ? <div key="sched" className="sched-block"><SecTitle hint="Tags match the plan">Opening Schedule</SecTitle>{schedFull}</div> : b === 'ehead' ? <R.Fragment key="ehead">{elevHead}</R.Fragment> : <R.Fragment key={specs[b].key}>{cards[b]}</R.Fragment>)}
            <div className="page-fill" />
            <PageFoot docInfo={docInfo} page={pi + 2} total={total} />
          </div>
        ))}
      </div>
      <div className="sheet-stage doc-print" ref={stageRef} aria-hidden="true">
        <div className="sheet stage-sheet doc-print" data-stage="p1top">{p1Core(null)}</div>
        <div className="sheet stage-sheet doc-print"><div data-stage="sched"><SecTitle hint="Tags match the plan">Opening Schedule</SecTitle>{schedBare}</div>
          <div data-stage="schedfull"><SecTitle hint="Tags match the plan">Opening Schedule</SecTitle>{schedFull}</div></div>
        <div className="sheet stage-sheet doc-print">
          <div data-stage="notes">{notesBlock}</div>
          <div data-stage="mini"><DocHeader docInfo={docInfo} building={building} revisionMode={revisionMode} compact page={2} total={2} /></div>
          <div data-stage="ehead">{elevHead}</div>
          <div data-stage="sign">{sign}</div>
          {specs.map((sp, i) => <div key={sp.key} data-stage={'e-' + sp.key}>{cards[i]}</div>)}
        </div>
      </div>
    </>
  )
}

// ── the Edit view: the same drawings, live and draggable ───────────────────
// One continuous white sheet (no page breaks while you work): the document
// header, the plan (drag / place on it), EVERY wall's elevation (drag along the
// wall, the chain updates live), the schedule. Lean-to openings move where the
// quote program gave them a spot; arrows nudge the selected one (app.jsx).
function SheetEdit(props) {
  const { building, docInfo, openings, tagMap, revisionMode, ed } = props
  const geom = docInfo && docInfo.geom ? docInfo.geom : null
  const specs = elevationSpecs(building, openings, geom, tagMap, { all: true })
  const sizeMismatch = geom && (geom.W !== Number(building.width) || geom.L !== Number(building.length))
  const W = Number(building.width) || 0, L = Number(building.length) || 0
  const planLegend = (geom && !sizeMismatch && Array.isArray(geom.leanTos) ? geom.leanTos : []).map(ltLegend)
  return (
    <div className="sheet-edit doc-print">
      <div className="sheet sheet-page sheet-edit-page doc-print">
        <DocHeader docInfo={docInfo} building={building} revisionMode={revisionMode} />
        <SecTitle hint={ed.placeType ? 'Click a wall to place · Alt = no snap · Esc to stop' : 'Drag any opening · snaps + aligns · arrows nudge (Shift 6″, Ctrl 1′) · Del removes'}>Building Plan</SecTitle>
        <div className="plan-key-wrap"><PlanKey building={building} openings={openings} tagMap={tagMap} geom={geom} ed={ed} />
          {planLegend.length > 0 && <div className="plan-legend">{planLegend.map((t, i) => <span key={i}>{t}</span>)}</div>}
          {sizeMismatch && <div className="plan-legend warn">The quote’s lean-tos / partitions are hidden: the building size was changed here from the quote’s {fmtFtIn(geom.W)} × {fmtFtIn(geom.L)}.</div>}</div>
        <SecTitle hint="Drag an opening along its wall · the chain updates live · same drawings as the Approval Sheet">Wall Elevations</SecTitle>
        <KeyLine />
        {specs.map((sp) => <ElevationCard key={sp.key} spec={sp} ed={ed} W={W} L={L} />)}
        <SecTitle hint="Tags match the plan and elevations">Opening Schedule</SecTitle>
        <window.Schedule building={building} openings={openings} tagMap={tagMap} />
      </div>
    </div>
  )
}
function ltLegend(l) {
  return `LT${l.n} · ${({ left: 'Left eave', right: 'Right eave', front: 'Front gable', back: 'Back gable' })[l.k] || l.side} · ${fmtFtIn(l.w)} W × ${fmtFtIn(l.len)} L · ${fmtFtIn(l.low)} low eave${l.stor ? ' · ' + fmtFtIn(l.stor.len) + ' storage at the ' + l.stor.end + ' end' : ''} · ${(l.walls && l.walls.mode) === 'enclosed' ? 'enclosed' : (l.walls && l.walls.mode) === 'custom' ? 'custom walls' : 'open'}`
}

window.SheetDoc = SheetDoc
window.SheetEdit = SheetEdit
window.SheetGeom = { parseLtId, getLtOpening, setLtOpeningX } // app.jsx: arrow-key nudge of a lean-to opening
window.SheetGeomFmt = fmtFtIn
