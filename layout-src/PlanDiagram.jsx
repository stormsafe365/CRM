/* ============================================================
   PlanDiagram.jsx — top-down building footprint with openings.

   Edge model: every wall maps to a screen edge (top/bottom/left/
   right) via a table; all rendering is derived from that, so the
   same code draws both orientations. Plus an "interior" edge for
   the hybrid divider wall.

   Length axis convention (consistent throughout): length=0 at the
   BACK wall, length=L at the FRONT wall. Screen-mapping:
     - LH orientation:  screenX = right - p * scale
     - WH orientation:  screenY = oy + p * scale

   Hybrid mode:
     - Open gable (front or back) renders as dashed outline, no fill
     - Side wall segments inside the open zone render dashed
     - Side-wall leg glyphs are omitted in the open zone
     - A heavy solid divider line runs across the building
     - Open zone gets a light tint + "CARPORT" label

   Interactive: drag to move (snap + alignment guides), live
   measurement readout, click-to-place ghost.
   ============================================================ */

function PlanDiagram({ building, openings, tagMap, showDims = true, showFrames = true, blueprint = false,
                       selectedId, onSelect, onMove, placeType, onPlace }) {
  const W = building.width, L = building.length;
  const svgRef = React.useRef(null);
  const [dragId, setDragId] = React.useState(null);
  const [snap, setSnap] = React.useState(null);
  const [ghost, setGhost] = React.useState(null);
  const movable = !!onMove;
  const placing = !!placeType;

  const hybrid = isHybrid(building);
  const carport = isCarport(building);
  const oz = hybrid ? openZone(building) : (carport ? [0, L] : null);
  const ez = hybrid ? enclosedZone(building) : (carport ? null : [0, L]);
  const dpFt = hybrid ? dividerLengthPos(building) : null;
  const openGable = hybrid ? building.openEnd : null;

  // longer dimension goes horizontal -> fills the wide page
  const lengthHorizontal = L >= W;
  const hSpan = lengthHorizontal ? L : W;
  const vSpan = lengthHorizontal ? W : L;

  const MAXW = 820, MAXL = 470;
  const scale = Math.min(MAXW / hSpan, MAXL / vSpan);
  const PAD = 68;
  const ox = PAD, oy = PAD;
  const bw = hSpan * scale, bh = vSpan * scale;
  const right = ox + bw, bottom = oy + bh;
  const svgW = bw + PAD * 2, svgH = bh + PAD * 2;
  // Snap zone in feet. Translates to ~3.5 px on screen — you have to be close.
  // Was 7px which felt sticky when trying to land between trusses or near a
  // neighbor opening; 3.5 lets you walk through the snap zone with a small move.
  const SNAP_FT = 3.5 / scale;
  // Free-drag rounding. 1/12 ft = exact 1″ increments — fine enough to feel
  // continuous when dragging while still landing on whole inches.
  const STEP_FT = 1 / 12;
  function roundStep(v) { return Math.round(v * 12) / 12; }

  const T = 13;
  const DIM_OFF = 26;
  const NAME_OFF = 58;

  // theme
  const ink      = blueprint ? 'var(--steel-100)' : 'var(--navy-900)';
  const gridCol  = blueprint ? 'rgba(154,169,187,0.22)' : 'var(--steel-100)';
  const dimCol   = blueprint ? 'var(--steel-400)' : 'var(--steel-600)';
  const dimText  = blueprint ? 'var(--steel-200)' : 'var(--navy-900)';
  const wallStroke = blueprint ? 'var(--steel-200)' : 'var(--navy-900)';
  const openTint = blueprint ? 'rgba(20,166,160,0.10)' : 'rgba(11,31,58,0.05)';
  const openHatch = blueprint ? 'rgba(20,166,160,0.32)' : 'rgba(11,31,58,0.13)';

  // ---- length-axis screen position (p = feet from back) ----
  function lengthToScreen(p) {
    return lengthHorizontal ? (right - p * scale) : (oy + p * scale);
  }

  // ---- wall -> edge mapping (the rotation lives here) ----
  const tableWH = {
    front: { edge: 'bottom', start: ox, dir: 1 },
    back:  { edge: 'top',    start: ox, dir: 1 },
    left:  { edge: 'left',   start: oy, dir: 1 },
    right: { edge: 'right',  start: oy, dir: 1 },
  };
  const tableLH = {
    front: { edge: 'left',   start: oy,    dir: 1 },
    back:  { edge: 'right',  start: oy,    dir: 1 },
    left:  { edge: 'top',    start: right, dir: -1 },
    right: { edge: 'bottom', start: right, dir: -1 },
  };
  const table = lengthHorizontal ? tableLH : tableWH;

  function meta(wall) {
    if (wall === 'divider') {
      if (!hybrid) return null;
      if (lengthHorizontal) {
        const cx = lengthToScreen(dpFt);
        // inDir points into the ENCLOSED zone (so the door tag pops up inside)
        // openEnd='front' (open on left in LH) -> enclosed is right of divider -> inDir=+1
        const inDir = building.openEnd === 'back' ? -1 : 1;
        return { edge: 'interior', orient: 'v', cx, cy: null, axisStart: oy, axisDir: 1, inDir };
      }
      const cy = lengthToScreen(dpFt);
      // openEnd='front' (open at bottom in WH) -> enclosed is above -> inDir=-1
      const inDir = building.openEnd === 'back' ? 1 : -1;
      return { edge: 'interior', orient: 'h', cx: null, cy, axisStart: ox, axisDir: 1, inDir };
    }
    const e = table[wall];
    if (!e) return null;
    const orient = (e.edge === 'top' || e.edge === 'bottom') ? 'h' : 'v';
    const cy = e.edge === 'top' ? oy : e.edge === 'bottom' ? bottom : null;
    const cx = e.edge === 'left' ? ox : e.edge === 'right' ? right : null;
    const inDir = e.edge === 'top' ? 1 : e.edge === 'bottom' ? -1 : e.edge === 'left' ? 1 : -1;
    return { edge: e.edge, orient, cx, cy, axisStart: e.start, axisDir: e.dir, inDir };
  }
  function ptAlong(m, p) {
    const a = m.axisStart + m.axisDir * p * scale;
    return m.orient === 'h' ? { x: a, y: m.cy } : { x: m.cx, y: a };
  }

  const wallsHere = visibleWalls(building);

  // ---------- footprint fill + grid ----------
  const footprint = [];
  footprint.push(<rect key="fill" x={ox} y={oy} width={bw} height={bh}
    fill={blueprint ? 'var(--navy-900)' : 'var(--white)'} />);

  // open-zone tint (sits on top of fill, under grid)
  if (oz) {
    const a = lengthToScreen(oz[0]);
    const b = lengthToScreen(oz[1]);
    if (lengthHorizontal) {
      footprint.push(<rect key="open" x={Math.min(a, b)} y={oy} width={Math.abs(b - a)} height={bh} fill={openTint} />);
    } else {
      footprint.push(<rect key="open" x={ox} y={Math.min(a, b)} width={bw} height={Math.abs(b - a)} fill={openTint} />);
    }
  }

  const grid = [];
  for (let f = 5; f < hSpan; f += 5) {
    const x = ox + f * scale;
    grid.push(<line key={'gv' + f} x1={x} y1={oy} x2={x} y2={bottom} stroke={gridCol} strokeWidth="1" />);
  }
  for (let f = 5; f < vSpan; f += 5) {
    const y = oy + f * scale;
    grid.push(<line key={'gh' + f} x1={ox} y1={y} x2={right} y2={y} stroke={gridCol} strokeWidth="1" />);
  }

  // ---------- wall edges: solid where sheeted, dashed where open ----------
  // For each wall, return one or more screen segments + whether they're "open"
  function wallEdgeSegments(wall) {
    if (wall === 'divider') return null;     // drawn separately as a heavy line
    if (wall === 'front' || wall === 'back') {
      const m = meta(wall);
      const open = (carport || (hybrid && wall === openGable));
      if (m.orient === 'h') return [{ x1: ox, y1: m.cy, x2: right, y2: m.cy, open }];
      return [{ x1: m.cx, y1: oy, x2: m.cx, y2: bottom, open }];
    }
    // side walls (left / right) — split at the divider when hybrid
    const m = meta(wall);
    if (!hybrid && !carport) {
      if (m.orient === 'h') return [{ x1: ox, y1: m.cy, x2: right, y2: m.cy, open: false }];
      return [{ x1: m.cx, y1: oy, x2: m.cx, y2: bottom, open: false }];
    }
    if (carport) {
      if (m.orient === 'h') return [{ x1: ox, y1: m.cy, x2: right, y2: m.cy, open: true }];
      return [{ x1: m.cx, y1: oy, x2: m.cx, y2: bottom, open: true }];
    }
    // hybrid: split at divider
    const splitScreen = lengthToScreen(dpFt);
    const ozMid = (oz[0] + oz[1]) / 2;
    const ezMid = (ez[0] + ez[1]) / 2;
    const segOpen = (lo, hi) => {
      const mid = (lo + hi) / 2;
      return Math.abs(mid - ozMid) < Math.abs(mid - ezMid);
    };
    if (m.orient === 'h') {
      // horizontal side wall in LH mode (y is constant)
      const y = m.cy;
      const a = Math.min(ox, splitScreen), b = Math.max(ox, splitScreen);
      const c = Math.min(splitScreen, right), d = Math.max(splitScreen, right);
      // segments in length-axis order need their lengthRange to tell open vs enclosed
      // length-from-back: at x=right -> p=0, at x=ox -> p=L. So mid-length of [right, splitScreen] = (0 + dpFt)/2.
      const s1Lo = 0, s1Hi = dpFt;                  // back side
      const s2Lo = dpFt, s2Hi = L;                  // front side
      return [
        { x1: Math.min(right, splitScreen), y1: y, x2: Math.max(right, splitScreen), y2: y, open: segOpen(s1Lo, s1Hi) },
        { x1: Math.min(ox, splitScreen),    y1: y, x2: Math.max(ox, splitScreen),    y2: y, open: segOpen(s2Lo, s2Hi) },
      ];
    }
    // vertical side wall in WH mode
    const x = m.cx;
    const s1Lo = 0, s1Hi = dpFt;
    const s2Lo = dpFt, s2Hi = L;
    return [
      { x1: x, y1: Math.min(oy, splitScreen),    x2: x, y2: Math.max(oy, splitScreen),    open: segOpen(s1Lo, s1Hi) },
      { x1: x, y1: Math.min(bottom, splitScreen), x2: x, y2: Math.max(bottom, splitScreen), open: segOpen(s2Lo, s2Hi) },
    ];
  }

  const perimeter = [];
  ['front', 'back', 'left', 'right'].forEach(wall => {
    const segs = wallEdgeSegments(wall) || [];
    segs.forEach((s, i) => {
      if (s.open) {
        perimeter.push(<line key={wall + '-' + i} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2}
          stroke={wallStroke} strokeWidth="1.5" strokeDasharray="7 4" opacity="0.65" strokeLinecap="round" />);
      } else {
        perimeter.push(<line key={wall + '-' + i} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2}
          stroke={wallStroke} strokeWidth="3" strokeLinecap="square" />);
      }
    });
  });
  // divider line (heavy + accent border so it reads as a built wall)
  if (hybrid) {
    const dm = meta('divider');
    if (dm.orient === 'h') {
      perimeter.push(<line key="div" x1={ox} y1={dm.cy} x2={right} y2={dm.cy}
        stroke={wallStroke} strokeWidth="3" />);
      perimeter.push(<line key="div-acc" x1={ox} y1={dm.cy - dm.inDir * 2.5} x2={right} y2={dm.cy - dm.inDir * 2.5}
        stroke="var(--teal-500)" strokeWidth="1.2" opacity="0.85" />);
    } else {
      perimeter.push(<line key="div" x1={dm.cx} y1={oy} x2={dm.cx} y2={bottom}
        stroke={wallStroke} strokeWidth="3" />);
      perimeter.push(<line key="div-acc" x1={dm.cx - dm.inDir * 2.5} y1={oy} x2={dm.cx - dm.inDir * 2.5} y2={bottom}
        stroke="var(--teal-500)" strokeWidth="1.2" opacity="0.85" />);
    }
  }

  // ---------- frames (trusses + leg glyphs); skip side-wall legs in open zone ----------
  // Trusses are drawn with three layers so the user can never confuse them with
  // dimension ticks or grid lines:
  //   1. interior dashed crossline (edge to edge of the building)
  //   2. bold leg "cap" sitting on the eave wall — wider than any dim tick
  //   3. TR# tag in the middle of the building so the count + spacing are obvious
  function legGlyph(cx, cy, inX, inY, type, key) {
    // wider, taller bar that visibly straddles the wall line — nothing else on
    // the plan uses this proportion so trusses read at a glance.
    const W = 8;            // along-wall thickness
    const H = 11;           // perpendicular (into the wall) height
    const ax = -inY, ay = inX;
    const legCol = blueprint ? 'var(--steel-100)' : 'var(--navy-800)';
    const bx = cx + inX * (H / 2 - 2.5);
    const by = cy + inY * (H / 2 - 2.5);
    const bar = (offset, k) => {
      const cxL = bx + ax * offset, cyL = by + ay * offset;
      // rect oriented along the wall: width = along-wall, height = perpendicular
      if (m_orient_h(inX, inY)) {
        return <rect key={k} x={cxL - W / 2} y={cyL - H / 2} width={W} height={H} rx="1"
          fill={legCol} stroke="var(--white)" strokeWidth="1" />;
      }
      return <rect key={k} x={cxL - H / 2} y={cyL - W / 2} width={H} height={W} rx="1"
        fill={legCol} stroke="var(--white)" strokeWidth="1" />;
    };
    const out = [];
    if (type === 'single') {
      out.push(bar(0, key + '1'));
    } else if (type === 'double') {
      out.push(bar(-3.2, key + '1'));
      out.push(bar(3.2, key + '2'));
    } else {
      // ladder: two outer posts + a connecting rung
      const o = 5;
      out.push(bar(-o, key + '1'));
      out.push(bar(o, key + '2'));
      const rx1 = bx + ax * -o, ry1 = by + ay * -o;
      const rx2 = bx + ax *  o, ry2 = by + ay *  o;
      out.push(<line key={key + 'r'} x1={rx1} y1={ry1} x2={rx2} y2={ry2} stroke={legCol} strokeWidth="1.6" />);
    }
    return <g key={key + 'g'}>{out}</g>;
  }
  // Tiny helper: is the leg on a top/bottom edge (h) or left/right edge (v)?
  function m_orient_h(inX, inY) { return inX === 0; }
  // ---------- frames split: interior dashed lines vs wall-edge caps ----------
  // Interior renders BEFORE openings; caps render AFTER so trusses stay visible
  // through any opening sitting on a frame line.
  function framesParts() {
    if (!showFrames) return { interior: null, caps: null };
    const stations = frameStations(L, building.trussOC);
    const bayPx = stations.length > 1 ? (stations[1] - stations[0]) * scale : 999;
    const lt = building.legType;
    const trussCol = blueprint ? 'rgba(154,169,187,0.55)' : 'var(--steel-500)';
    const interior = [];
    const caps = [];
    stations.forEach((p, i) => {
      const isEnd = i === 0 || i === stations.length - 1;
      const inOpenZone = oz && p > oz[0] + 0.01 && p < oz[1] - 0.01;
      const sideLegsAllowed = !inOpenZone;
      const sx = lengthToScreen(p);
      if (!isEnd && bayPx >= 5) {
        if (lengthHorizontal) {
          interior.push(<line key={'tr' + i} x1={sx} y1={oy + 2} x2={sx} y2={bottom - 2}
            stroke={trussCol} strokeWidth="1.4" strokeDasharray="5 4" />);
        } else {
          interior.push(<line key={'tr' + i} x1={ox + 2} y1={sx} x2={right - 2} y2={sx}
            stroke={trussCol} strokeWidth="1.4" strokeDasharray="5 4" />);
        }
      }
      if (lengthHorizontal) {
        if (bayPx >= 7 && sideLegsAllowed) {
          caps.push(legGlyph(sx, oy, 0, 1, lt, 'la' + i));
          caps.push(legGlyph(sx, bottom, 0, -1, lt, 'lb' + i));
        }
      } else {
        if (bayPx >= 7 && sideLegsAllowed) {
          caps.push(legGlyph(ox, sx, 1, 0, lt, 'la' + i));
          caps.push(legGlyph(right, sx, -1, 0, lt, 'lb' + i));
        }
      }
    });
    if (hybrid) {
      const dx = lengthToScreen(dpFt);
      if (lengthHorizontal) {
        caps.push(legGlyph(dx, oy, 0, 1, building.legType, 'div-la'));
        caps.push(legGlyph(dx, bottom, 0, -1, building.legType, 'div-lb'));
      } else {
        caps.push(legGlyph(ox, dx, 1, 0, building.legType, 'div-la'));
        caps.push(legGlyph(right, dx, -1, 0, building.legType, 'div-lb'));
      }
    }
    return {
      interior: <g className="frames-interior">{interior}</g>,
      caps: <g className="frames-caps">{caps}</g>,
    };
  }
  const { interior: framesInteriorEl, caps: framesCapsEl } = framesParts();

  // ---------- wall-name bands ----------
  function band(wall) {
    const m = meta(wall);
    if (!m) return null;
    const ext = -m.inDir;
    let label = `${WALLS[wall].label}\u00A0\u00A0·\u00A0\u00A0${ftInTight(wallLength(wall, building))}`;
    if (hybrid && wall === openGable) label += '\u00A0\u00A0·\u00A0\u00A0OPEN';
    if (wall === 'divider') label = `${WALLS[wall].label}\u00A0\u00A0·\u00A0\u00A0${ftInTight(W)}`;
    const common = {
      fontFamily: 'var(--font-display)', fontWeight: '700', fontSize: wall === 'divider' ? '12' : '13',
      letterSpacing: '1.5', fill: wall === 'divider' ? 'var(--teal-500)' : ink, style: { textTransform: 'uppercase' },
    };
    if (wall === 'divider') {
      // divider label rides ALONG the wall, just inside the enclosed zone
      if (m.orient === 'h') {
        return <text key="nb-divider" x={ox + bw / 2} y={m.cy + m.inDir * 11} textAnchor="middle"
          dominantBaseline={m.inDir > 0 ? 'hanging' : 'auto'} {...common}>{label}</text>;
      }
      const x = m.cx + m.inDir * 11, y = oy + bh / 2;
      return <text key="nb-divider" x={x} y={y} textAnchor="middle" dominantBaseline={m.inDir > 0 ? 'hanging' : 'auto'}
        transform={`rotate(-90 ${x} ${y})`} {...common}>{label}</text>;
    }
    if (m.orient === 'h') {
      const x = ox + bw / 2, y = m.cy + ext * NAME_OFF + (ext > 0 ? 4 : 0);
      return <text key={'nb-' + wall} x={x} y={y} textAnchor="middle" {...common}>{label}</text>;
    }
    const x = m.cx + ext * NAME_OFF, y = oy + bh / 2;
    return <text key={'nb-' + wall} x={x} y={y} textAnchor="middle" transform={`rotate(-90 ${x} ${y})`} {...common}>{label}</text>;
  }

  // ---------- dimension chain ----------
  function dimChain(wall) {
    const m = meta(wall);
    if (!m) return null;
    const wl = wallLength(wall, building);
    const ops = openings.filter(o => o.wall === wall).slice().sort((a, b) => a.offset - b.offset);
    if (!ops.length) return null;
    const bounds = [0];
    ops.forEach(o => { bounds.push(o.offset); bounds.push(o.offset + o.w); });
    bounds.push(wl);
    const segs = [];
    for (let i = 0; i < bounds.length - 1; i++) {
      const a = Math.max(0, Math.min(wl, bounds[i]));
      const b = Math.max(0, Math.min(wl, bounds[i + 1]));
      const len = b - a;
      if (len < 0.02) continue;
      const mid = (a + b) / 2;
      const isOp = ops.some(o => mid > o.offset + 0.01 && mid < o.offset + o.w - 0.01);
      segs.push({ a, b, len, isOp });
    }
    // For divider, draw the dim chain on the enclosed side, but very close to the wall (inside the building).
    const ext = wall === 'divider' ? m.inDir : -m.inDir;
    const dimOff = wall === 'divider' ? 19 : DIM_OFF;
    const els = [];
    if (m.orient === 'h') {
      const dimY = m.cy + ext * dimOff;
      els.push(<line key="dl" x1={ptAlong(m, 0).x} y1={dimY} x2={ptAlong(m, wl).x} y2={dimY} stroke={dimCol} strokeWidth="1" />);
      bounds.forEach((p, i) => {
        const x = ptAlong(m, p).x;
        els.push(<line key={'w' + i} x1={x} y1={m.cy + ext * 6} x2={x} y2={dimY} stroke={dimCol} strokeWidth="0.75" opacity="0.6" />);
        els.push(<line key={'t' + i} x1={x} y1={dimY - 4} x2={x} y2={dimY + 4} stroke={dimCol} strokeWidth="1.25" />);
      });
      segs.forEach((s, i) => {
        const xm = ptAlong(m, (s.a + s.b) / 2).x;
        els.push(<text key={'s' + i} x={xm} y={dimY + ext * 9 + (ext > 0 ? 4 : 0)} textAnchor="middle"
          dominantBaseline={ext < 0 ? 'auto' : 'hanging'}
          fontFamily="var(--font-mono)" fontSize="11" fontWeight={s.isOp ? 700 : 400}
          fill={s.isOp ? 'var(--navy-900)' : dimText}
          style={blueprint ? { fill: s.isOp ? 'var(--teal-300)' : dimText } : null}>{ftInTight(s.len)}</text>);
      });
    } else {
      const dimX = m.cx + ext * dimOff;
      els.push(<line key="dl" x1={dimX} y1={ptAlong(m, 0).y} x2={dimX} y2={ptAlong(m, wl).y} stroke={dimCol} strokeWidth="1" />);
      bounds.forEach((p, i) => {
        const y = ptAlong(m, p).y;
        els.push(<line key={'w' + i} x1={m.cx + ext * 6} y1={y} x2={dimX} y2={y} stroke={dimCol} strokeWidth="0.75" opacity="0.6" />);
        els.push(<line key={'t' + i} x1={dimX - 4} y1={y} x2={dimX + 4} y2={y} stroke={dimCol} strokeWidth="1.25" />);
      });
      segs.forEach((s, i) => {
        const ym = ptAlong(m, (s.a + s.b) / 2).y;
        const tx = dimX + ext * 11;
        els.push(<text key={'s' + i} x={tx} y={ym} textAnchor="middle" transform={`rotate(-90 ${tx} ${ym})`}
          fontFamily="var(--font-mono)" fontSize="11" fontWeight={s.isOp ? 700 : 400}
          fill={s.isOp ? 'var(--navy-900)' : dimText}
          style={blueprint ? { fill: s.isOp ? 'var(--teal-300)' : dimText } : null}>{ftInTight(s.len)}</text>);
      });
    }
    return <g key={'dim-' + wall}>{els}</g>;
  }

  // ---------- zone labels ----------
  function zoneLabels() {
    if (!hybrid && !carport) return null;
    const els = [];
    function labelAt(zoneFt, text, sub) {
      const mid = (zoneFt[0] + zoneFt[1]) / 2;
      let x, y;
      if (lengthHorizontal) { x = lengthToScreen(mid); y = oy + bh / 2; }
      else { x = ox + bw / 2; y = lengthToScreen(mid); }
      els.push(<g key={text}>
        <text x={x} y={y - 4} textAnchor="middle" dominantBaseline="auto"
          fontFamily="var(--font-display)" fontWeight="700" fontSize="14" letterSpacing="2"
          fill={blueprint ? 'var(--teal-300)' : 'var(--navy-700)'} opacity="0.85"
          style={{ textTransform: 'uppercase' }}>{text}</text>
        {sub && <text x={x} y={y + 12} textAnchor="middle" dominantBaseline="hanging"
          fontFamily="var(--font-mono)" fontSize="10" fontWeight="500"
          fill={blueprint ? 'var(--steel-400)' : 'var(--steel-600)'}>{sub}</text>}
      </g>);
    }
    if (carport) {
      labelAt([0, L], 'CARPORT', ftInTight(W) + ' × ' + ftInTight(L));
    } else {
      if (ez && ez[1] - ez[0] > 6) labelAt(ez, 'ENCLOSED', ftInTight(ez[1] - ez[0]) + ' LONG');
      if (oz && oz[1] - oz[0] > 6) labelAt(oz, 'CARPORT', ftInTight(oz[1] - oz[0]) + ' LONG');
    }
    return <g>{els}</g>;
  }

  // ---------- openings ----------
  function renderOpening(op) {
    const t = OPENING_TYPES[op.type];
    const m = meta(op.wall);
    if (!m) return null;
    const tag = tagMap[op.id];
    const sel = op.id === selectedId;
    const isDrag = op.id === dragId;
    const color = t.color;
    const TT = isDrag ? T + 5 : T;
    const els = [];

    const pA = m.axisStart + m.axisDir * op.offset * scale;
    const pB = m.axisStart + m.axisDir * (op.offset + op.w) * scale;
    const aMin = Math.min(pA, pB), aLen = Math.abs(pB - pA), aMid = (pA + pB) / 2;
    const lift = { filter: isDrag ? 'drop-shadow(0 3px 6px rgba(11,31,58,.45))' : 'none', transition: 'all .12s var(--ease-out)' };

    function swing() {
      if (!t.swing) return null;
      const r = aLen;
      const N = ptAlong(m, op.offset);
      const Fp = ptAlong(m, op.offset + op.w);
      const inward = m.orient === 'h' ? { x: 0, y: m.inDir } : { x: m.inDir, y: 0 };
      const leaf = { x: N.x + inward.x * r, y: N.y + inward.y * r };
      const along = { x: (Fp.x - N.x) / (r || 1), y: (Fp.y - N.y) / (r || 1) };
      const sweep = (inward.x * along.y - inward.y * along.x) > 0 ? 1 : 0;
      return <path d={`M ${N.x} ${N.y} L ${leaf.x} ${leaf.y} M ${leaf.x} ${leaf.y} A ${r} ${r} 0 0 ${sweep} ${Fp.x} ${Fp.y}`}
        fill="none" stroke={color} strokeWidth="1" opacity="0.5" strokeDasharray="3 3" />;
    }

    if (m.orient === 'h') {
      els.push(<rect key="bar" x={aMin} y={m.cy - TT / 2} width={aLen} height={TT} rx="1.5"
        fill={color} stroke="var(--white)" strokeWidth="1.5" style={lift} />);
      els.push(<g key="sw">{swing()}</g>);
      const tcx = aMid, tcy = m.cy + m.inDir * 17;
      els.push(<circle key="tc" cx={tcx} cy={tcy} r="10" fill={color} stroke="var(--white)" strokeWidth="1.5" />);
      els.push(<text key="tt" x={tcx} y={tcy + 0.5} textAnchor="middle" dominantBaseline="central"
        fontFamily="var(--font-mono)" fontWeight="700" fontSize="10.5" fill="var(--white)">{tag}</text>);
      els.push(<text key="sz" x={tcx} y={m.cy + m.inDir * 34} textAnchor="middle"
        fontFamily="var(--font-mono)" fontSize="10.5" fontWeight="500"
        fill={blueprint ? 'var(--steel-200)' : 'var(--navy-900)'}>{sizeLabel(op)}</text>);
      if (sel) els.push(<rect key="ring" x={aMin - 4} y={m.cy - TT / 2 - 4} width={aLen + 8} height={TT + 8} rx="3"
        fill="none" stroke="var(--teal-500)" strokeWidth="2" className="op-sel-ring" />);
      els.push(<rect key="hit" x={aMin - 8} y={m.inDir > 0 ? m.cy - 12 : m.cy - 44}
        width={aLen + 16} height={56} fill="transparent"
        style={{ cursor: movable ? (isDrag ? 'grabbing' : 'grab') : (onSelect ? 'pointer' : 'default') }}
        onPointerDown={(e) => startDrag(e, op.id)} />);
    } else {
      els.push(<rect key="bar" x={m.cx - TT / 2} y={aMin} width={TT} height={aLen} rx="1.5"
        fill={color} stroke="var(--white)" strokeWidth="1.5" style={lift} />);
      els.push(<g key="sw">{swing()}</g>);
      const tcx = m.cx + m.inDir * 17, tcy = aMid;
      els.push(<circle key="tc" cx={tcx} cy={tcy} r="10" fill={color} stroke="var(--white)" strokeWidth="1.5" />);
      els.push(<text key="tt" x={tcx} y={tcy + 0.5} textAnchor="middle" dominantBaseline="central"
        fontFamily="var(--font-mono)" fontWeight="700" fontSize="10.5" fill="var(--white)">{tag}</text>);
      const lx = m.cx + m.inDir * 34, ly = aMid;
      els.push(<text key="sz" x={lx} y={ly} textAnchor="middle" transform={`rotate(-90 ${lx} ${ly})`}
        fontFamily="var(--font-mono)" fontSize="10.5" fontWeight="500"
        fill={blueprint ? 'var(--steel-200)' : 'var(--navy-900)'}>{sizeLabel(op)}</text>);
      if (sel) els.push(<rect key="ring" x={m.cx - TT / 2 - 4} y={aMin - 4} width={TT + 8} height={aLen + 8} rx="3"
        fill="none" stroke="var(--teal-500)" strokeWidth="2" className="op-sel-ring" />);
      els.push(<rect key="hit" x={m.inDir > 0 ? m.cx - 12 : m.cx - 44} y={aMin - 8}
        width={56} height={aLen + 16} fill="transparent"
        style={{ cursor: movable ? (isDrag ? 'grabbing' : 'grab') : (onSelect ? 'pointer' : 'default') }}
        onPointerDown={(e) => startDrag(e, op.id)} />);
    }
    return <g key={op.id} className="op-grp">{els}</g>;
  }

  // ---------- placement overlay: guide + dual dimension pills + truss badge ----------
  // Shared by both drag (snap state) and place ghost (ghost state).
  function placementOverlay(mode) {
    const isDrag = mode === 'drag';
    let wall, off, w, guide, guideKind;
    if (isDrag) {
      if (dragId == null) return null;
      const op = openings.find(o => o.id === dragId);
      if (!op || !snap) return null;
      wall = op.wall; off = op.offset; w = op.w;
      guide = snap.guide; guideKind = snap.guideKind;
    } else {
      if (!placing || !ghost) return null;
      const def = OPENING_TYPES[placeType];
      wall = ghost.wall; off = ghost.off; w = def.w;
      guide = ghost.guide; guideKind = ghost.guideKind;
    }
    const m = meta(wall); if (!m) return null;
    const wallSpan = wallLength(wall, building);
    const isTruss = guideKind === 'truss';
    const els = [];

    // alignment guide line — thick/solid teal when on a truss; otherwise dashed accent
    if (guide != null) {
      if (m.orient === 'h') {
        const x = ptAlong(m, guide).x;
        els.push(<line key="g" x1={x} y1={oy - 24} x2={x} y2={bottom + 24}
          stroke="var(--teal-500)" strokeWidth={isTruss ? '2.5' : '1'}
          strokeDasharray={isTruss ? '0' : '4 4'} opacity={isTruss ? '1' : '0.9'} />);
      } else {
        const y = ptAlong(m, guide).y;
        els.push(<line key="g" x1={ox - 24} y1={y} x2={right + 24} y2={y}
          stroke="var(--teal-500)" strokeWidth={isTruss ? '2.5' : '1'}
          strokeDasharray={isTruss ? '0' : '4 4'} opacity={isTruss ? '1' : '0.9'} />);
      }
    }

    // dual distance pills — distance to BOTH corners of the wall
    const startDist = off;
    const endDist = wallSpan - off - w;
    const isEave = (wall === 'left' || wall === 'right');
    const startLabel = isEave ? 'BACK' : 'LEFT';
    const endLabel   = isEave ? 'FRONT' : 'RIGHT';

    function dimPill(text, gapMidFt, key) {
      const c = ptAlong(m, gapMidFt);
      const wpill = text.length * 6.5 + 18;
      let px = c.x, py = c.y;
      // sit just OUTSIDE the wall so the pill doesn't cover the dimension chain
      if (m.orient === 'h') py = m.cy - m.inDir * 14;
      else px = m.cx - m.inDir * 16;
      // keep on-screen
      px = Math.max(wpill / 2 + 2, Math.min(svgW - wpill / 2 - 2, px));
      py = Math.max(13, Math.min(svgH - 13, py));
      return <g key={key} style={{ pointerEvents: 'none' }}>
        <rect x={px - wpill / 2} y={py - 11} width={wpill} height={22} rx="11"
          fill="var(--navy-900)" stroke="var(--teal-500)" strokeWidth="1" />
        <text x={px} y={py + 0.5} textAnchor="middle" dominantBaseline="central"
          fontFamily="var(--font-mono)" fontSize="11" fontWeight="700" fill="var(--teal-300)">{text}</text>
      </g>;
    }

    if (startDist > 0.3) els.push(dimPill(`${ftInTight(startDist)} ${startLabel}`, off / 2, 'p1'));
    if (endDist > 0.3)   els.push(dimPill(`${ftInTight(endDist)} ${endLabel}`, off + w + endDist / 2, 'p2'));
    // when the opening is flush against a corner, label that 0 explicitly inside the opening's center
    if (startDist <= 0.3) els.push(dimPill(`0 ${startLabel} CORNER`, off + w / 2, 'p1'));
    if (endDist <= 0.3)   els.push(dimPill(`0 ${endLabel} CORNER`, off + w / 2, 'p2'));

    // ON TRUSS badge — strong, sits inside the building so it's never confused with chrome
    if (isTruss && isEave) {
      const c = ptAlong(m, off + w / 2);
      let px = c.x, py = c.y;
      if (m.orient === 'h') { py = m.cy + m.inDir * 52; }
      else { px = m.cx + m.inDir * 64; }
      const txt = '◆ ON TRUSS';
      const wpill = txt.length * 6.8 + 16;
      els.push(<g key="truss-badge" style={{ pointerEvents: 'none' }}>
        <rect x={px - wpill / 2} y={py - 12} width={wpill} height={24} rx="3"
          fill="var(--teal-500)" stroke="var(--white)" strokeWidth="1.5" />
        <text x={px} y={py + 0.5} textAnchor="middle" dominantBaseline="central"
          fontFamily="var(--font-display)" fontSize="11" fontWeight="700" fill="var(--white)"
          style={{ textTransform: 'uppercase', letterSpacing: '1.5px' }}>{txt}</text>
      </g>);
    }

    return <g>{els}</g>;
  }

  function dragOverlay() { return placementOverlay('drag'); }
  function placeOverlay() { return placementOverlay('place'); }

  // ---------- place ghost ----------
  function ghostEl() {
    if (!placing || !ghost) return null;
    const def = OPENING_TYPES[placeType];
    const m = meta(ghost.wall);
    if (!m) return null;
    const pA = m.axisStart + m.axisDir * ghost.off * scale;
    const pB = m.axisStart + m.axisDir * (ghost.off + def.w) * scale;
    const aMin = Math.min(pA, pB), aLen = Math.abs(pB - pA);
    if (m.orient === 'h') {
      return <rect x={aMin} y={m.cy - 8} width={aLen} height={16} rx="2" fill={def.color} opacity="0.55" stroke="var(--white)" strokeWidth="1.5" strokeDasharray="4 3" style={{ pointerEvents: 'none' }} />;
    }
    return <rect x={m.cx - 8} y={aMin} width={16} height={aLen} rx="2" fill={def.color} opacity="0.55" stroke="var(--white)" strokeWidth="1.5" strokeDasharray="4 3" style={{ pointerEvents: 'none' }} />;
  }

  // ---------- pointer math ----------
  function clientToSvg(e) {
    const svg = svgRef.current; if (!svg) return null;
    const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const mx = svg.getScreenCTM(); if (!mx) return null;
    return pt.matrixTransform(mx.inverse());
  }
  function nearestWall(p, w) {
    let best = null;
    wallsHere.forEach(wall => {
      const m = meta(wall);
      if (!m) return;
      const dist = m.orient === 'h' ? Math.abs(p.y - m.cy) : Math.abs(p.x - m.cx);
      const alongPx = m.orient === 'h' ? p.x : p.y;
      if (!best || dist < best.dist) best = { wall, dist, m, alongPx };
    });
    if (!best) return null;
    const { m, alongPx, wall } = best;
    const pft = (alongPx - m.axisStart) / (m.axisDir * scale);
    return { wall, off: pft - w / 2 };
  }
  function snapOffset(wall, rawOff, w, id, opts) {
    const wl = wallLength(wall, building);
    const noTrussSnap = opts && opts.noTrussSnap;
    // Candidate snap lines with a 'kind' so we can render them differently.
    const lines = [];
    function add(p, kind) { lines.push({ pos: p, kind }); }
    add(0, 'edge'); add(wl, 'edge'); add(wl / 2, 'center');
    for (let f = 5; f < wl; f += 5) add(f, 'grid');
    // Trusses run perpendicular to length, so they snap only on the eave (side) walls.
    // We track them separately so they ONLY pull the opening's CENTER (not its
    // left/right edges) — otherwise a 9′ garage door would have 3 chances to
    // hit every truss and would be impossible to place in between.
    const trussLines = [];
    if (!noTrussSnap && (wall === 'left' || wall === 'right')) {
      frameStations(L, building.trussOC).forEach(p => trussLines.push(p));
    }
    openings.forEach(o => {
      if (o.id === id || o.wall !== wall) return;
      add(o.offset, 'neighbor'); add(o.offset + o.w, 'neighbor'); add(o.offset + o.w / 2, 'neighbor');
    });
    const anchors = [
      { pos: rawOff, toOff: (Lp) => Lp },
      { pos: rawOff + w / 2, toOff: (Lp) => Lp - w / 2 },
      { pos: rawOff + w, toOff: (Lp) => Lp - w },
    ];
    // Standard snap distance for non-truss lines (~7px on screen, so ~5″ at default zoom)
    const SNAP = SNAP_FT;
    // Truss snap is HALF the standard — you have to mean it. And we only use the
    // center anchor against trusses, so wide openings have one chance not three.
    const TRUSS_SNAP = SNAP_FT * 0.5;
    let best = null;
    lines.forEach(L => anchors.forEach(a => {
      const d = Math.abs(a.pos - L.pos);
      if (d < SNAP && (!best || d < best.d)) best = { d, off: a.toOff(L.pos), line: L.pos, kind: L.kind };
    }));
    // Center-only truss snap, evaluated after general snaps so a neighbor or
    // dimension line that's already pulled the opening wins on ties.
    trussLines.forEach(Lp => {
      const d = Math.abs((rawOff + w / 2) - Lp);
      if (d < TRUSS_SNAP && (!best || d < best.d * 0.95)) {
        best = { d, off: Lp - w / 2, line: Lp, kind: 'truss' };
      }
    });
    if (best) return { off: Math.max(0, Math.min(wl - w, best.off)), guide: best.line, guideKind: best.kind };
    let off = roundStep(rawOff);
    return { off: Math.max(0, Math.min(wl - w, off)), guide: null, guideKind: null };
  }

  function startDrag(e, id) {
    if (placing) return;
    if (onSelect) onSelect(id);
    if (!movable) return;
    e.preventDefault();
    setDragId(id);
    try { svgRef.current.setPointerCapture(e.pointerId); } catch (_) {}
  }
  function onPointerMove(e) {
    // Hold Alt/Option while dragging or placing to bypass ALL snapping — the
    // escape hatch when the user truly wants a free position.
    const noSnap = !!e.altKey;
    if (placing) {
      const def = OPENING_TYPES[placeType];
      const p = clientToSvg(e); if (!p) return;
      const nw = nearestWall(p, def.w); if (!nw) return;
      const s = noSnap
        ? { off: Math.max(0, Math.min(wallLength(nw.wall, building) - def.w, roundStep(nw.off))), guide: null, guideKind: null }
        : snapOffset(nw.wall, nw.off, def.w, null);
      setGhost({ wall: nw.wall, off: s.off, guide: s.guide, guideKind: s.guideKind });
      return;
    }
    if (!movable || dragId == null) return;
    const op = openings.find(o => o.id === dragId);
    if (!op) return;
    const p = clientToSvg(e); if (!p) return;
    const nw = nearestWall(p, op.w); if (!nw) return;
    const s = noSnap
      ? { off: Math.max(0, Math.min(wallLength(nw.wall, building) - op.w, roundStep(nw.off))), guide: null, guideKind: null }
      : snapOffset(nw.wall, nw.off, op.w, op.id);
    setSnap({ wall: nw.wall, guide: s.guide, off: s.off, guideKind: s.guideKind });
    onMove(dragId, { wall: nw.wall, offset: s.off });
  }
  function endDrag(e) {
    if (dragId != null) {
      try { svgRef.current.releasePointerCapture(e.pointerId); } catch (_) {}
      setDragId(null); setSnap(null);
    }
  }
  function onSvgPointerDown(e) {
    if (!placing) return;
    const def = OPENING_TYPES[placeType];
    const p = clientToSvg(e); if (!p) return;
    const nw = nearestWall(p, def.w); if (!nw) return;
    const s = snapOffset(nw.wall, nw.off, def.w, null);
    onPlace(nw.wall, s.off);
  }

  const centerSummary = `${ftInTight(W)} W × ${ftInTight(L)} L`;
  const subSummary = hybrid
    ? `${CONFIG_LABEL.hybrid.toUpperCase()} · ${ftInTight((ez[1] - ez[0]))} ENCLOSED / ${ftInTight(oz[1] - oz[0])} OPEN`
    : (carport ? `CARPORT · ${ftInTight(building.height)} EAVE`
              : (showFrames ? `${frameCount(L, building.trussOC)} FRAMES · ${building.trussOC}′ OC`
                            : `${ftInTight(building.height)} EAVE · PLAN VIEW`));

  return (
    <svg ref={svgRef} viewBox={`0 0 ${svgW} ${svgH}`} role="img" aria-label="Building opening plan"
      onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag}
      onPointerDown={onSvgPointerDown}
      onPointerLeave={() => placing && setGhost(null)}
      style={(movable || placing) ? { touchAction: 'none', cursor: placing ? 'copy' : 'default' } : null}>
      {footprint}
      <g>{grid}</g>
      {framesInteriorEl}
      {perimeter}
      {zoneLabels()}
      {!hybrid && !carport && <g>
        <rect x={ox + bw / 2 - 96} y={oy + bh / 2 - 24} width={192} height={42} rx="3"
          fill={blueprint ? 'var(--navy-900)' : 'var(--white)'} opacity="0.82" />
        <text x={ox + bw / 2} y={oy + bh / 2 - 6} textAnchor="middle"
          fontFamily="var(--font-display)" fontWeight="700" fontSize="16" letterSpacing="0.5"
          fill={blueprint ? 'var(--steel-300)' : 'var(--navy-900)'} style={{ textTransform: 'uppercase' }}>
          {centerSummary}
        </text>
        <text x={ox + bw / 2} y={oy + bh / 2 + 14} textAnchor="middle"
          fontFamily="var(--font-mono)" fontSize="11"
          fill={blueprint ? 'var(--steel-400)' : 'var(--steel-600)'}>
          {subSummary}
        </text>
      </g>}
      {showDims && wallsHere.map(w => dimChain(w))}
      {wallsHere.map(w => band(w))}
      {openings.map(renderOpening)}
      {framesCapsEl}
      {ghostEl()}
      {placeOverlay()}
      {dragOverlay()}
    </svg>
  );
}

window.PlanDiagram = PlanDiagram;
