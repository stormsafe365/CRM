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

import {
  elevationSpecs, elevLayout, fmtFtIn, ltRect, ltOpeningPlan, trussFromFront, paginate,
  offsetFromFrameX, ltDrawToProg, snapAlong, wallSnapLines, ltWallLen, parseLtId, getLtOpening, setLtOpeningX,
} from './sheetGeom.js'

const R = window.React

// Opening colours — the schedule's tag colours (data.js OPENING_TYPES), as
// hex so the PDF renderer never has to resolve a CSS variable. No yellow;
// roll-ups wear the warm accent.
const TYPE_HEX = {
  rollup: '#f0883e', walk: '#14A6A0', double: '#0E7A76', window: '#36598F',
  sliding: '#14A269', framed: '#5A6A7E', custom: '#1A3556',
}
const ROLE_HEX = { rollup: '#f0883e', walk: '#14A6A0', window: '#36598F', framed: '#5A6A7E' }
const INK = '#0B1F3A', LINE = '#9AA9BB', SOFT = '#C9D2DC', MUTED = '#5A6A7E', TEAL = '#14A6A0'
const colorOf = (it) => TYPE_HEX[it.type] || ROLE_HEX[it.role] || '#5A6A7E'

const PAGE_H = 1056, PAGE_PAD_B = 16, FOOT_H = 22
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
  const VW = CARD_W, mL = 56, mR = 56, mT = 38, mB = 42
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
  // building footprint
  els.push(<rect key="bf" x={PZ(0)} y={PX(0)} width={(L * s).toFixed(1)} height={(W * s).toFixed(1)} fill="#F4F7FA" stroke="none" />)
  // frame lines
  if (!ed || ed.showFrames !== false) trussFromFront(building, g).forEach((t, i) => els.push(
    <line key={'tr' + i} x1={PZ(t)} y1={PX(0)} x2={PZ(t)} y2={PX(W)} stroke={SOFT} strokeWidth="0.8" strokeDasharray="3 4" />))
  // lean-tos
  lts.forEach((l) => {
    const r = ltRect(l, W, L)
    const x = PZ(r.z0), y = PX(r.x0), w = (r.z1 - r.z0) * s, h = (r.x1 - r.x0) * s
    els.push(<rect key={'lt' + l.n} x={x} y={y} width={w.toFixed(1)} height={h.toFixed(1)} fill="rgba(20,166,160,0.06)" stroke={TEAL} strokeWidth="1" strokeDasharray={l.walls && l.walls.side === 'closed' ? null : '5 3'} />)
    if (l.stor) {
      const eave = l.k === 'left' || l.k === 'right'
      if (eave) els.push(<line key={'lts' + l.n} x1={PZ(l.stor.at)} y1={y} x2={PZ(l.stor.at)} y2={y + h} stroke={INK} strokeWidth="1.2" strokeDasharray="5 3" />)
      else { const d = l.k === 'back' ? W - l.stor.at : l.stor.at; els.push(<line key={'lts' + l.n} x1={x} y1={PX(d)} x2={x + w} y2={PX(d)} stroke={INK} strokeWidth="1.2" strokeDasharray="5 3" />) }
    }
    const full = `LT${l.n} · ${fmtFtIn(l.w)} × ${fmtFtIn(l.len)} · ${fmtFtIn(l.low)} low eave${l.stor ? ' · ' + fmtFtIn(l.stor.len) + ' storage (' + l.stor.end + ')' : ''}`
    const short = `LT${l.n}`
    // centred in the longest stretch the storage partition leaves (never across its line)
    let cxL = x + w / 2, cyL = y + h / 2, room = l.k === 'left' || l.k === 'right' ? w : h
    if (l.stor) {
      if (l.k === 'left' || l.k === 'right') { const a = PZ(l.stor.at); const pick = a - x >= x + w - a ? [x, a] : [a, x + w]; cxL = (pick[0] + pick[1]) / 2; room = pick[1] - pick[0] }
      else { const d = PX(l.k === 'back' ? W - l.stor.at : l.stor.at); const pick = d - y >= y + h - d ? [y, d] : [d, y + h]; cyL = (pick[0] + pick[1]) / 2 }
    }
    const fits = (l.k === 'left' || l.k === 'right') ? (full.length * 5.6 < room - 10 && h >= 16) : (full.length * 5.6 < w - 10 && h >= 16)
    els.push(<text key={'ltt' + l.n} x={cxL.toFixed(1)} y={(cyL + 3.5).toFixed(1)} textAnchor="middle" fontSize="10" fontWeight="600" fill="#0E7A76" letterSpacing=".02em">{fits ? full : short}</text>)
    // lean-to openings (the program's spots)
    ;(l.openings || []).forEach((o, oi) => {
      if (!Array.isArray(o.xs)) return
      o.xs.forEach((xx, i) => {
        const p = ltOpeningPlan(l, o.loc, xx, o.w, W, L)
        const id = `lt${l.n}-${oi}-${i}`
        if (ed && ed.selectedId === id) els.push(<line key={'lsel' + id} x1={PZ(p.z0)} y1={PX(p.x0)} x2={PZ(p.z1)} y2={PX(p.x1)} stroke={TEAL} strokeOpacity="0.35" strokeWidth="10" />)
        els.push(<line key={`lto${l.n}-${oi}-${i}`} x1={PZ(p.z0)} y1={PX(p.x0)} x2={PZ(p.z1)} y2={PX(p.x1)} stroke={ROLE_HEX[roleOf(o.type)]} strokeWidth="3.4" strokeLinecap="butt" data-op={id} />)
        if (ed) els.push(<line key={'lhit' + id} x1={PZ(p.z0)} y1={PX(p.x0)} x2={PZ(p.z1)} y2={PX(p.x1)} stroke="transparent" strokeWidth="14" className="op-hit" data-hit={id}
          onPointerDown={(e) => startLt(e, l, o, { n: l.n, oi, i }, xx)} />)
      })
    })
  })
  // partitions
  if (hybrid && window.hasDivider && window.hasDivider(building)) {
    const z = L - window.dividerLengthPos(building)
    els.push(<line key="div" x1={PZ(z)} y1={PX(0)} x2={PZ(z)} y2={PX(W)} stroke={INK} strokeWidth="1.4" strokeDasharray="5 3" />)
  }
  if (g && g.partition) {
    const p = g.partition
    if (p.kind === 'x') els.push(<line key="pt" x1={PZ(0)} y1={PX(p.at)} x2={PZ(L)} y2={PX(p.at)} stroke={INK} strokeWidth="1.2" strokeDasharray="5 3" />)
    else {
      els.push(<line key="pt" x1={PZ(p.at)} y1={PX(0)} x2={PZ(p.at)} y2={PX(W)} stroke={INK} strokeWidth="1.2" strokeDasharray="5 3" />)
      ;(p.items || []).forEach((it, i) => els.push(<line key={'pti' + i} x1={PZ(p.at) + 3} y1={PX(it.x)} x2={PZ(p.at) + 3} y2={PX(it.x + it.w)} stroke={ROLE_HEX[roleOf(it.type)]} strokeWidth="3.4" />))
    }
  }
  // walls
  const WL = { front: [PZ(0), PX(0), PZ(0), PX(W)], back: [PZ(L), PX(0), PZ(L), PX(W)], left: [PZ(0), PX(0), PZ(L), PX(0)], right: [PZ(0), PX(W), PZ(L), PX(W)] }
  Object.keys(WL).forEach((k) => {
    const [a, b, c, d] = WL[k]
    els.push(<line key={'w' + k} x1={a} y1={b} x2={c} y2={d} stroke={INK} strokeWidth="1.4" strokeLinecap="square" strokeDasharray={wallOpen[k] ? '6 4' : null} />)
  })
  // main openings: a coloured bar on the wall + its schedule tag outside
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
    const col = TYPE_HEX[op.type] || MUTED
    if (ed && ed.selectedId === op.id) els.push(<line key={'sel' + op.id} x1={PZ(seg[0])} y1={PX(seg[1])} x2={PZ(seg[2])} y2={PX(seg[3])} stroke={TEAL} strokeOpacity="0.35" strokeWidth="11" />)
    els.push(<line key={'op' + op.id} x1={PZ(seg[0])} y1={PX(seg[1])} x2={PZ(seg[2])} y2={PX(seg[3])} stroke={col} strokeWidth="4" data-op={op.id} />)
    if (ed) els.push(<line key={'hit' + op.id} x1={PZ(seg[0])} y1={PX(seg[1])} x2={PZ(seg[2])} y2={PX(seg[3])} stroke="transparent" strokeWidth="16" className="op-hit" data-hit={op.id}
      onPointerDown={(e) => startMain(e, op)} />)
    const tag = tagMap[op.id]
    if (tag) {
      const cz = PZ((seg[0] + seg[2]) / 2) + out[0] * 11, cx = PX((seg[1] + seg[3]) / 2) + out[1] * 11
      // a lean-to on that side: the tag sits inside the building instead, clear of it
      const flip = (op.wall === 'left' && ext.left) || (op.wall === 'right' && ext.right) || (op.wall === 'front' && ext.front) || (op.wall === 'back' && ext.back)
      const tz = flip ? PZ((seg[0] + seg[2]) / 2) - out[0] * 11 : cz, tx = flip ? PX((seg[1] + seg[3]) / 2) - out[1] * 11 : cx
      els.push(<g key={'tg' + op.id}><circle cx={tz} cy={tx} r="7" fill={col} /><text x={tz} y={tx + 3.3} textAnchor="middle" fontSize="9" fontWeight="700" fill="#fff">{tag}</text></g>)
    }
  })
  // names + overall sizes
  const lbl = (k, x, y, t, rot, anchor = 'middle') => els.push(
    <text key={k} x={x} y={y} textAnchor={anchor} fontSize="9" fontWeight="600" fill={MUTED} letterSpacing=".14em" transform={rot ? `rotate(${rot} ${x} ${y})` : null}>{t}</text>)
  const nT = ext.left ? 9 : 22, nB = ext.right ? 16 : 30, nF = ext.front ? 12 : 26, nK = ext.back ? 14 : 28
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
    <svg ref={svgRef} className={'plan-key' + (ed ? ' is-edit' : '') + (ed && ed.placeType ? ' is-placing' : '')} viewBox={`0 0 ${VW} ${VH}`} width={VW} height={VH} xmlns="http://www.w3.org/2000/svg" fontFamily="Inter, Barlow, Arial, sans-serif"
      onPointerMove={ed ? onMove : undefined} onPointerUp={ed ? onUp : undefined} onPointerCancel={ed ? onUp : undefined} onPointerDown={ed ? onDown : undefined}>
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
  // ground line
  els.push(<line key="gnd" x1="8" y1={gy} x2={VW - 8} y2={gy} stroke={SOFT} strokeWidth="1" />)
  // lean-tos end-on beside this wall
  ;(spec.side || []).forEach((q, i) => {
    const pts = q.onLeft ? [[-q.w, 0], [-q.w, q.low], [0, q.conn], [0, 0]] : [[F, 0], [F, q.conn], [F + q.w, q.low], [F + q.w, 0]]
    els.push(<polygon key={'sl' + i} points={pts.map(([x, h]) => `${X(x).toFixed(1)},${Y(h).toFixed(1)}`).join(' ')} fill="rgba(20,166,160,0.05)" stroke={TEAL} strokeWidth="1" strokeDasharray="4 3" />)
    els.push(<text key={'slt' + i} x={X(q.onLeft ? -q.w / 2 : F + q.w / 2)} y={Y(q.low / 2) + 3} textAnchor="middle" fontSize="9.5" fontWeight="600" fill="#0E7A76">{q.label}</text>)
  })
  // the wall outline
  const pts = []
  pts.push([0, 0], [0, spec.h(0)])
  if (spec.gable) pts.push([F / 2, spec.h(F / 2)])
  pts.push([F, spec.h(F)], [F, 0])
  els.push(<polygon key="wall" points={pts.map(([x, h]) => `${X(x).toFixed(1)},${Y(h).toFixed(1)}`).join(' ')} fill={spec.open ? 'none' : '#FAFBFC'} stroke={INK} strokeWidth="1.1" strokeLinejoin="round" strokeDasharray={spec.open ? '6 4' : null} />)
  if (spec.gable) els.push(<line key="eave" x1={X(0)} y1={Y(spec.eave)} x2={X(F)} y2={Y(spec.eave)} stroke={SOFT} strokeWidth="0.8" strokeDasharray="4 4" />)
  if (spec.open) els.push(<text key="ow" x={X(F / 2)} y={Y(spec.eave) + 14} textAnchor="middle" fontSize="9.5" fill={MUTED}>open wall</text>)
  // frame lines at the real OC
  ;(spec.truss || []).forEach((t, i) => {
    if (t <= 1e-6 || t >= F - 1e-6) return
    els.push(<line key={'fl' + i} x1={X(t)} y1={gy} x2={X(t)} y2={Y(spec.h(t))} stroke={LINE} strokeWidth="0.8" strokeDasharray="3 4" />)
  })
  if ((spec.truss || []).length && spec.oc) els.push(<text key="flt" x={X(F)} y={Y(spec.h(F)) - 8} textAnchor="end" fontSize="10" fill={MUTED}>{`frame lines ${fmtFtIn(spec.oc)} OC`}</text>)
  // lean-to storage partition on its outer wall
  if (spec.storX != null) {
    els.push(<line key="st" x1={X(spec.storX)} y1={gy} x2={X(spec.storX)} y2={Y(spec.eave)} stroke={INK} strokeWidth="1.2" strokeDasharray="5 3" />)
    els.push(<text key="stt" x={X(spec.storX) + 4} y={Y(spec.eave) + 11} fontSize="8.5" fill="#0E7A76">storage partition</text>)
  }
  // a lean-to hanging off this wall: dashed footprint to its connection height
  // Its label never sits on an opening or an opening's labels: above the
  // footprint, else inside it at the bottom / top, else just "LTn" there and
  // the full text in the card's legend line.
  // W×H label inside the opening when it fits there, else just above it (never under the tag)
  const sizeLabelY = (it, ry, rw, rh) => {
    const lw = (fmtFtIn(it.w).length + fmtFtIn(it.h).length + 1) * (rw < 52 ? 4.8 : 5.4)
    return rh >= 26 && rw >= lw + 4 ? ry + 12 : ry - 4
  }
  const legend = []
  const busy = spec.items.flatMap((it) => {
    const rx = X(it.x), ry = Y(it.sill + it.h), rw = it.w * s, rh = it.h * s
    const lw = (fmtFtIn(it.w).length + fmtFtIn(it.h).length + 1) * 6
    const ly = sizeLabelY(it, ry, rw, rh)
    return [{ x0: rx - 18, x1: rx + rw, y0: ry, y1: ry + rh }, { x0: rx + rw / 2 - lw / 2, x1: rx + rw / 2 + lw / 2, y0: ly - 10, y1: ly + 2 }]
  })
  if ((spec.truss || []).length && spec.oc) busy.push({ x0: X(F) - 110, x1: X(F), y0: Y(spec.h(F)) - 18, y1: Y(spec.h(F)) - 4 })
  const clear = (b) => busy.every((q) => b.x1 <= q.x0 || b.x0 >= q.x1 || b.y1 <= q.y0 || b.y0 >= q.y1)
  ;(spec.foot || []).forEach((f, i) => {
    els.push(<rect key={'ft' + i} x={X(f.x0)} y={Y(f.h)} width={(f.len * s).toFixed(1)} height={(f.h * s).toFixed(1)} fill="rgba(20,166,160,0.05)" stroke={TEAL} strokeWidth="1" strokeDasharray="5 4" />)
    const spots = [Y(f.h) - 4, Y(0) - 5, Y(f.h) + 13]
    const tryText = (txt) => {
      const tw = txt.length * 5.8
      if (tw > f.len * s - 8 && spots.length) return null
      for (const y of spots) { const b = { x0: X(f.x0) + 5, x1: X(f.x0) + 5 + tw, y0: y - 10, y1: y + 2 }; if (clear(b)) { busy.push(b); return y } }
      return null
    }
    let txt = f.label, y = tryText(txt)
    if (y == null) { txt = f.label.split(' · ')[0]; y = tryText(txt); legend.push(f.label) }
    if (y == null) y = Y(f.h) - 4
    els.push(<text key={'ftt' + i} x={X(f.x0) + 5} y={y} fontSize="9.5" fontWeight="600" fill="#0E7A76">{txt}</text>)
  })
  // openings: dashed hatched rectangle, W×H, sill, tag
  const items = spec.items.slice().sort((a, b) => a.x - b.x)
  items.forEach((it) => {
    const col = colorOf(it)
    const rx = X(it.x), ry = Y(it.sill + it.h), rw = it.w * s, rh = it.h * s
    const pid = 'h-' + (it.type || it.role)
    const movable = !!ed && (spec.wall ? true : !!it.lt)
    if (ed && ed.selectedId === it.id) els.push(<rect key={'sel' + it.id} x={(rx - 3).toFixed(1)} y={(ry - 3).toFixed(1)} width={(rw + 6).toFixed(1)} height={(rh + 6).toFixed(1)} fill="none" stroke={TEAL} strokeOpacity="0.55" strokeWidth="3" />)
    els.push(<rect key={'o' + it.id} x={rx.toFixed(1)} y={ry.toFixed(1)} width={rw.toFixed(1)} height={rh.toFixed(1)} fill={`url(#${pid})`} stroke={col} strokeWidth="1.1" strokeDasharray="4 2.5" data-op={it.id}
      className={movable ? 'op-hit' : undefined} onPointerDown={movable ? (e) => startDrag(e, it) : undefined} />)
    const lab = `${fmtFtIn(it.w)}×${fmtFtIn(it.h)}`
    const fs = rw < 52 ? 8.5 : 9.5
    const ly = sizeLabelY(it, ry, rw, rh)
    els.push(<text key={'ol' + it.id} x={(rx + rw / 2).toFixed(1)} y={ly.toFixed(1)} textAnchor="middle" fontSize={fs} fontWeight="600" fill={INK} className="op-size">{lab}</text>)
    if (it.sill > 0.1) els.push(<text key={'os' + it.id} x={(rx + rw / 2).toFixed(1)} y={((Y(0) + Y(it.sill)) / 2 + 3).toFixed(1)} textAnchor="middle" fontSize="8.5" fill={MUTED} className="op-sill">{`sill ${fmtFtIn(it.sill)}`}</text>)
    if (it.tag) {
      const cx = rx - 9, cy = ry + Math.min(rh / 2, Math.max(rh - 8, 8))
      els.push(<g key={'otg' + it.id}><circle cx={cx.toFixed(1)} cy={cy.toFixed(1)} r="6.5" fill={col} /><text x={cx.toFixed(1)} y={(cy + 3).toFixed(1)} textAnchor="middle" fontSize="8.5" fontWeight="700" fill="#fff">{it.tag}</text></g>)
    }
  })
  // leg / eave height on the right
  const hR = spec.h(F), dx = X(F + lay.extR) + 16
  els.push(<g key="leg">
    <line x1={dx} y1={Y(0)} x2={dx} y2={Y(hR)} stroke={LINE} strokeWidth="1" />
    <line x1={dx - 4} y1={Y(0)} x2={dx + 4} y2={Y(0)} stroke={LINE} strokeWidth="1" />
    <line x1={dx - 4} y1={Y(hR)} x2={dx + 4} y2={Y(hR)} stroke={LINE} strokeWidth="1" />
    <text x={dx + 7} y={(Y(0) + Y(hR)) / 2 + 4} fontSize="10.5" fontWeight="600" fill={INK}>{`${fmtFtIn(hR)} ${spec.sloped ? '' : 'leg'}`.trim()}</text>
  </g>)
  if (spec.sloped) els.push(<text key="h0" x={X(0) - 6} y={Y(spec.h(0)) + 4} textAnchor="end" fontSize="10" fontWeight="600" fill={INK}>{fmtFtIn(spec.h(0))}</text>)
  if (spec.gable) {
    const pitch = typeof spec.peak === 'number' ? spec.peak : 0
    els.push(<text key="pk" x={X(F / 2)} y={Y(pitch) - 8} textAnchor="middle" fontSize="9.5" fill={MUTED}>{`peak ${fmtFtIn(pitch)}`}</text>)
  }
  // the chain: corner -> opening edges -> corner; gaps above the line, widths below
  if (lay.segs.length) {
    const a0 = lay.segs[0].a, a1 = lay.segs[lay.segs.length - 1].b
    els.push(<line key="ch" x1={X(a0 / 96)} y1={dy} x2={X(a1 / 96)} y2={dy} stroke={LINE} strokeWidth="1" />)
    const stops = Array.from(new Set(lay.segs.flatMap((sg) => [sg.a, sg.b])))
    stops.forEach((t) => els.push(<line key={'ck' + t} x1={X(t / 96)} y1={dy - 4} x2={X(t / 96)} y2={dy + 4} stroke={LINE} strokeWidth="1" />))
    lay.rows.forEach((r, i) => els.push(
      <text key={'cl' + i} x={r.cx.toFixed(1)} y={lay.rowY(r.row).toFixed(1)} textAnchor="middle" fontSize="9.5"
        fontWeight={r.kind === 'width' ? 700 : 400} fill={r.kind === 'width' ? INK : MUTED}
        className={'ch-' + r.kind} data-e8={r.d}>{r.text}</text>))
  }
  // overall + end names
  els.push(<g key="ov">
    <line x1={X(0)} y1={dy2} x2={X(F)} y2={dy2} stroke={LINE} strokeWidth="1" />
    <line x1={X(0)} y1={dy2 - 5} x2={X(0)} y2={dy2 + 5} stroke={LINE} strokeWidth="1" />
    <line x1={X(F)} y1={dy2 - 5} x2={X(F)} y2={dy2 + 5} stroke={LINE} strokeWidth="1" />
    <rect x={X(F / 2) - 30} y={dy2 - 8} width="60" height="16" fill="#fff" />
    <text x={X(F / 2)} y={dy2 + 4.5} textAnchor="middle" fontSize="12" fontWeight="700" fill={INK} className="ch-total">{fmtFtIn(F)}</text>
    <text x={X(0)} y={dy2 + 18} fontSize="8.5" fontWeight="600" fill={MUTED} letterSpacing=".14em">{spec.ends[0]}</text>
    <text x={X(F)} y={dy2 + 18} textAnchor="end" fontSize="8.5" fontWeight="600" fill={MUTED} letterSpacing=".14em">{spec.ends[1]}</text>
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
  const types = Array.from(new Set(items.map((it) => it.type || it.role)))
  return (
    <div className={'elev-card' + (ed ? ' is-edit' : '')} data-elev={spec.key}>
      <div className="elev-head">
        <span className="elev-title">{spec.title}</span>
        <span className="elev-sub">{spec.sub}</span>
        <span className="elev-meta">{`${items.length} opening${items.length === 1 ? '' : 's'}`}</span>
      </div>
      <svg ref={svgRef} className={'elev-svg' + (ed && ed.placeType && spec.wall ? ' is-placing' : '')} viewBox={`0 0 ${VW} ${VH}`} width={CARD_W} height={Math.round(VH * CARD_W / VW)} xmlns="http://www.w3.org/2000/svg" fontFamily="Inter, Barlow, Arial, sans-serif"
        onPointerMove={ed ? onMove : undefined} onPointerUp={ed ? onUp : undefined} onPointerCancel={ed ? onUp : undefined} onPointerDown={ed ? onDown : undefined}>
        <defs>{types.map((t) => {
          const col = TYPE_HEX[t] || ROLE_HEX[t] || MUTED
          return <pattern key={t} id={'h-' + t} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="5" stroke={col} strokeOpacity="0.35" strokeWidth="0.8" /></pattern>
        })}</defs>
        {els}
      </svg>
      {(spec.notes || []).concat(legend).length > 0 && <div className="elev-notes">{(spec.notes || []).concat(legend).map((n, i) => <div key={i}>{n}</div>)}</div>}
    </div>
  )
}

// ── the document ───────────────────────────────────────────────────────────
function MiniHead({ docInfo, revisionMode, page, total }) {
  return (
    <div className="mini-head">
      <div className="wordmark"><span>STORM</span><span className="t">SAFE</span><span>&nbsp;STEEL</span></div>
      <div className="mini-meta">
        <span>{revisionMode ? 'Revised Layout Approval' : 'Building Approval Sheet'}</span>
        {docInfo.customer ? <span>{docInfo.customer}</span> : null}
        {docInfo.quoteNo ? <span className="mono">{docInfo.quoteNo}</span> : null}
        <span>Elevations · page {page} of {total}</span>
      </div>
    </div>
  )
}
function PageFoot({ page, total }) {
  return <div className="page-foot"><span>All dimensions to the opening edge, measured along grade from the wall corners · feet-inches to the nearest 1/8 inch</span><span>Page {page} of {total}</span></div>
}

function SheetDoc(props) {
  const { building, docInfo, openings, tagMap, style, revisionMode } = props
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
  const sign = <div className="sign-block">{revisionMode && H.RevChanges()}{H.SignOff({ revisionMode })}</div>
  const p1Core = (sched) => (
    <>
      {H.Masthead({ revisionMode })}
      {H.InfoStrip({ docInfo })}
      {revisionMode && H.RevStrip()}
      {H.SpecBand({ building, docInfo })}
      <div className="block-title"><h2>Building Plan</h2><span className="hint">Top view · lean-tos, frame lines and openings to scale · tags match the schedule</span></div>
      <div className="plan-key-wrap"><PlanKey building={building} openings={openings} tagMap={tagMap} geom={geom} />
        {planLegend.length > 0 && <div className="plan-legend">{planLegend.map((t, i) => <span key={i}>{t}</span>)}</div>}</div>
      <div className="block-title"><h2>Opening Schedule</h2><span className="hint">{specs.length ? 'Elevations follow · tags match the plan' : 'Tags match the plan'}</span></div>
      {sched}
    </>
  )
  const schedFull = <window.Schedule building={notesB} openings={openings} tagMap={tagMap} />
  const schedBare = <window.Schedule building={{ ...notesB, notes: [] }} openings={openings} tagMap={tagMap} />
  const notesBlock = notesB.notes && notesB.notes.length ? (
    <div className="notes-block"><div className="block-title"><h2>Quote Notes</h2><span className="hint">Continued from page 1</span></div>
      <table className="sched"><tbody className="sched-notes">{notesB.notes.map((n, i) => <tr key={i}><td>{n}</td></tr>)}</tbody></table></div>) : null

  // Measure (off-screen staging copy) → decide pages. Runs before paint.
  const sig = JSON.stringify([specs.map((s) => [s.key, s.items.length]), openings.length, notesB.notes, revisionMode, docInfo.customer, docInfo.address, docInfo.quoteNo, building.width, building.length])
  R.useLayoutEffect(() => {
    const st = stageRef.current
    if (!st) return
    const hOf = (sel) => { const el = st.querySelector(sel); return el ? el.getBoundingClientRect().height : 0 }
    const avail1 = PAGE_H - PAGE_PAD_B - FOOT_H
    const core = hOf('[data-stage="p1"]')
    const notesH = hOf('[data-stage="notes"]'), notesRowsH = notesH - hOf('[data-stage="notes"] .block-title')
    const signH = hOf('[data-stage="sign"]') + 12
    const hasNotes = !!(notesB.notes && notesB.notes.length)
    const notesOnP1 = !hasNotes || core + notesRowsH <= avail1
    const p1Room = avail1 - core - (hasNotes && notesOnP1 ? notesRowsH : 0)
    const headH = hOf('[data-stage="mini"]')
    const availN = PAGE_H - PAGE_PAD_B - FOOT_H - headH - 8
    // blocks for the elevation pages: the quote notes first when page 1 can't hold them
    const ids = [...(notesOnP1 ? [] : ['notes']), ...specs.map((_, i) => i)]
    const heights = ids.map((b) => (b === 'notes' ? notesH + 12 : hOf(`[data-stage="e-${specs[b].key}"]`) + 12))
    const pg = paginate(heights, availN, signH, 3, p1Room)
    const next = { notesOnP1, signOnP1: pg.signOnP1, pages: pg.pages.map((p) => p.map((i) => (i === 'sign' ? 'sign' : ids[i]))) }
    const k = JSON.stringify(next)
    if (!plan || plan.k !== k || plan.sig !== sig) setPlan({ ...next, k, sig })
  })

  const ready = plan && plan.sig === sig
  const pages = ready ? plan.pages : []
  const total = 1 + pages.length
  const docCls = 'sheet-doc style-' + style
  return (
    <>
      <div className={docCls}>
        <div className={'sheet sheet-page p1 style-' + style}>
          {p1Core(ready && !plan.notesOnP1 ? schedBare : schedFull)}
          {ready && plan.signOnP1 && sign}
          <div className="page-fill" />
          <PageFoot page={1} total={total} />
        </div>
        {pages.map((blk, pi) => (
          <div key={pi} className={'sheet sheet-page pn style-' + style}>
            <MiniHead docInfo={docInfo} revisionMode={revisionMode} page={pi + 2} total={total} />
            {blk.map((b) => b === 'sign' ? <R.Fragment key="sign">{sign}</R.Fragment> : b === 'notes' ? <R.Fragment key="notes">{notesBlock}</R.Fragment> : <R.Fragment key={specs[b].key}>{cards[b]}</R.Fragment>)}
            <div className="page-fill" />
            <PageFoot page={pi + 2} total={total} />
          </div>
        ))}
      </div>
      <div className="sheet-stage" ref={stageRef} aria-hidden="true">
        <div className={'sheet stage-sheet style-' + style} data-stage="p1">{p1Core(schedBare)}</div>
        <div className={'sheet stage-sheet style-' + style}>
          <div data-stage="notes">{notesBlock}</div>
          <div data-stage="mini"><MiniHead docInfo={docInfo} revisionMode={revisionMode} page={2} total={2} /></div>
          <div data-stage="sign">{sign}</div>
          {specs.map((sp, i) => <div key={sp.key} data-stage={'e-' + sp.key}>{cards[i]}</div>)}
        </div>
      </div>
    </>
  )
}

// ── the Edit view: the same drawings, live and draggable ───────────────────
// Owner 10/6: the edit view must look like the new design and show the
// lean-tos. One continuous sheet (no page breaks while you work): header,
// the plan (drag / place on it), EVERY wall's elevation (drag along the wall,
// the chain updates live), the schedule. Lean-to openings move where the
// quote program gave them a spot; arrows nudge the selected one (app.jsx).
function SheetEdit(props) {
  const { building, docInfo, openings, tagMap, style, revisionMode, ed } = props
  const geom = docInfo && docInfo.geom ? docInfo.geom : null
  const specs = elevationSpecs(building, openings, geom, tagMap, { all: true })
  const sizeMismatch = geom && (geom.W !== Number(building.width) || geom.L !== Number(building.length))
  const H = window.SheetParts
  const W = Number(building.width) || 0, L = Number(building.length) || 0
  const planLegend = (geom && !sizeMismatch && Array.isArray(geom.leanTos) ? geom.leanTos : []).map(ltLegend)
  return (
    <div className="sheet-edit">
      <div className={'sheet sheet-page sheet-edit-page style-' + style}>
        {H.Masthead({ revisionMode })}
        {H.InfoStrip({ docInfo })}
        {revisionMode && H.RevStrip()}
        {H.SpecBand({ building, docInfo })}
        <div className="block-title"><h2>Building Plan</h2><span className="hint">{ed.placeType ? 'Click a wall to place · Alt = no snap · Esc to stop' : 'Drag any opening · snaps + aligns · arrows nudge (Shift 6″, Ctrl 1′) · Del removes'}</span></div>
        <div className="plan-key-wrap"><PlanKey building={building} openings={openings} tagMap={tagMap} geom={geom} ed={ed} />
          {planLegend.length > 0 && <div className="plan-legend">{planLegend.map((t, i) => <span key={i}>{t}</span>)}</div>}
          {sizeMismatch && <div className="plan-legend warn">The quote’s lean-tos / partitions are hidden: the building size was changed here from the quote’s {fmtFtIn(geom.W)} × {fmtFtIn(geom.L)}.</div>}</div>
        <div className="block-title"><h2>Wall Elevations</h2><span className="hint">Drag an opening along its wall · the chain updates live · same drawings as the Approval Sheet</span></div>
        {specs.map((sp) => <ElevationCard key={sp.key} spec={sp} ed={ed} W={W} L={L} />)}
        <div className="block-title"><h2>Opening Schedule</h2><span className="hint">Tags match the plan and elevations</span></div>
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
