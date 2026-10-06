(() => {
  // layout-src/sheetGeom.js
  var EIGHTHS = 96;
  function e8(ft) {
    const v = Math.round(Number(ft) * EIGHTHS);
    return v === 0 || !isFinite(v) ? 0 : v;
  }
  var FRAC = ["", "⅛", "¼", "⅜", "½", "⅝", "¾", "⅞"];
  function fmtFtIn(ft) {
    if (ft == null || isNaN(ft)) return "—";
    const e = e8(ft), a = Math.abs(e);
    const f = Math.floor(a / 96), r = a - f * 96;
    return (e < 0 ? "−" : "") + (r ? `${f}′${Math.floor(r / 8)}${FRAC[r % 8]}″` : `${f}′`);
  }
  var fmt8 = (n) => fmtFtIn(n / EIGHTHS);
  function chain(items, faceW) {
    const list = (items || []).filter((it) => it && isFinite(it.x) && isFinite(it.w));
    if (!list.length) return [];
    const F = e8(faceW);
    const spans = list.map((it) => [e8(it.x), e8(it.x) + e8(it.w)]);
    const stops = Array.from(/* @__PURE__ */ new Set([0, F, ...spans.flat()])).sort((a, b) => a - b);
    const out = [];
    for (let i = 0; i < stops.length - 1; i++) {
      const a = stops[i], b = stops[i + 1];
      if (b - a < 1) continue;
      const inside = spans.some(([s, t]) => s <= a && t >= b);
      out.push({ a, b, d: b - a, kind: inside ? "width" : "gap" });
    }
    return out;
  }
  function chainRows(segs, px, charW = 5.4) {
    const last = [-1e9, -1e9, -1e9, -1e9];
    return segs.map((sg) => {
      const text = fmt8(sg.d);
      const cx = (px(sg.a) + px(sg.b)) / 2;
      const half = text.length * charW / 2 + 2;
      const base = sg.kind === "gap" ? 0 : 1;
      let row = base;
      if (cx - half < last[row] + 3) row = base + 2;
      if (cx - half < last[row] + 3) row = base;
      last[row] = cx + half;
      return { ...sg, text, cx, row };
    });
  }
  function frameX(op, W, L) {
    const off = e8(op.offset), w = e8(op.w);
    if (op.wall === "back") return (e8(W) - off - w) / EIGHTHS;
    if (op.wall === "right") return (e8(L) - off - w) / EIGHTHS;
    return off / EIGHTHS;
  }
  var ROLE = { rollup: "rollup", walk: "walk", double: "walk", window: "window", sliding: "rollup", framed: "framed", custom: "framed" };
  function item(op, x, extra) {
    return {
      x,
      w: e8(op.w) / EIGHTHS,
      h: e8(op.h) / EIGHTHS,
      sill: e8(op.sill || 0) / EIGHTHS,
      type: op.type,
      role: ROLE[op.type] || "framed",
      id: op.id,
      ...extra
    };
  }
  function parsePitchNum(p) {
    if (p == null) return 0;
    if (typeof p === "number") return p / 12;
    const m = String(p).split(/[:/]/);
    const rise = parseFloat(m[0]), run = parseFloat(m[1] != null ? m[1] : "12");
    return isFinite(rise) && isFinite(run) && run ? rise / run : 0;
  }
  function trussFromFront(building, geom) {
    const L = Number(building.length) || 0;
    if (geom && Array.isArray(geom.truss) && geom.truss.length) return geom.truss.filter((t) => t > 0 && t < L);
    const oc = Number(building.trussOC) || 0;
    const out = [];
    if (oc > 0) for (let t = oc; t < L - 1e-6; t += oc) out.push(t);
    return out;
  }
  function ltRect(l, W, L) {
    if (l.k === "left") return { z0: l.start, z1: l.start + l.len, x0: -l.w, x1: 0 };
    if (l.k === "right") return { z0: l.start, z1: l.start + l.len, x0: W, x1: W + l.w };
    if (l.k === "front") return { z0: -l.w, z1: 0, x0: l.start, x1: l.start + l.len };
    return { z0: L, z1: L + l.w, x0: W - l.start - l.len, x1: W - l.start };
  }
  function ltOpeningPlan(l, loc, x, w, W, L) {
    const r = ltRect(l, W, L);
    const eave = l.k === "left" || l.k === "right";
    if (loc === "outer") {
      if (eave) {
        const xx = l.k === "left" ? -l.w : W + l.w;
        return { z0: l.start + x, z1: l.start + x + w, x0: xx, x1: xx };
      }
      const zz = l.k === "front" ? -l.w : L + l.w;
      return { z0: zz, z1: zz, x0: r.x1 - x - w, x1: r.x1 - x };
    }
    let at;
    if (eave) at = loc === "front" ? r.z0 : loc === "back" ? r.z1 : l.stor ? l.stor.at : r.z0;
    else at = loc === "front" ? r.x1 : loc === "back" ? r.x0 : l.stor ? l.k === "back" ? W - l.stor.at : l.stor.at : r.x0;
    if (l.k === "left") return { z0: at, z1: at, x0: -(x + w), x1: -x };
    if (l.k === "right") return { z0: at, z1: at, x0: W + l.w - x - w, x1: W + l.w - x };
    if (l.k === "front") return { z0: -l.w + x, z1: -l.w + x + w, x0: at, x1: at };
    return { z0: L + x, z1: L + x + w, x0: at, x1: at };
  }
  var SIDE_LT_NAME = { left: "Left eave", right: "Right eave", front: "Front gable", back: "Back gable" };
  function elevationSpecs(building, openings, geom, tagMap = {}) {
    const W = Number(building.width) || 0, L = Number(building.length) || 0, H = Number(building.height) || 0;
    const pitch = parsePitchNum(building.pitch);
    const peak = H + W / 2 * pitch;
    const gableH = (x) => H + Math.min(Math.max(x, 0), Math.max(W - x, 0)) * pitch;
    const flatH = () => H;
    const g = geom && geom.W === W && geom.L === L ? geom : null;
    const lts = g && Array.isArray(g.leanTos) ? g.leanTos : [];
    const eaveLTs = lts.filter((l) => l.k === "left" || l.k === "right");
    const gableLTs = lts.filter((l) => l.k === "front" || l.k === "back");
    const open = g && g.open || {};
    const hybrid = building.config === "hybrid";
    const carport = building.config === "carport";
    const ops = (openings || []).filter((o) => o && isFinite(o.offset) && o.w > 0);
    const on = (wall) => ops.filter((o) => o.wall === wall).map((o) => item(o, frameX(o, W, L), { tag: tagMap[o.id] }));
    const tFront = trussFromFront(building, g);
    const oc = g && g.oc || Number(building.trussOC) || 0;
    const out = [];
    const push = (spec) => {
      if (spec.items.length || spec.notes && spec.notes.length) out.push(spec);
    };
    const ltFoot = (l, x0) => ({ x0, len: l.len, h: l.conn, label: `LT${l.n} · ${fmtFtIn(l.w)} × ${fmtFtIn(l.len)} lean-to` });
    const ltSide = (l, onLeft) => ({ onLeft, w: l.w, low: l.low, conn: l.conn, label: `LT${l.n}` });
    const frontOpen = hybrid ? building.openEnd === "front" : carport || !!open.front;
    const backOpen = hybrid ? building.openEnd === "back" : carport || !!open.back;
    push({
      key: "front",
      title: "Front gable",
      sub: "seen from the front",
      faceW: W,
      gable: true,
      eave: H,
      peak,
      h: gableH,
      items: on("front"),
      ends: ["LEFT EAVE", "RIGHT EAVE"],
      truss: [],
      oc: 0,
      open: frontOpen,
      side: eaveLTs.map((l) => ltSide(l, l.k === "left")),
      foot: gableLTs.filter((l) => l.k === "front").map((l) => ltFoot(l, l.start))
    });
    push({
      key: "back",
      title: "Back gable",
      sub: "seen from behind",
      faceW: W,
      gable: true,
      eave: H,
      peak,
      h: gableH,
      items: on("back"),
      ends: ["RIGHT EAVE", "LEFT EAVE"],
      truss: [],
      oc: 0,
      open: backOpen,
      side: eaveLTs.map((l) => ltSide(l, l.k === "right")),
      foot: gableLTs.filter((l) => l.k === "back").map((l) => ltFoot(l, l.start))
    });
    if (hybrid) {
      push({
        key: "divider",
        title: "Partition wall",
        sub: "enclosed bay · seen from the front",
        faceW: W,
        gable: true,
        eave: H,
        peak,
        h: gableH,
        items: on("divider"),
        ends: ["LEFT EAVE", "RIGHT EAVE"],
        truss: [],
        oc: 0,
        open: false,
        side: [],
        foot: []
      });
    }
    if (g && g.partition && Array.isArray(g.partition.items) && g.partition.items.length) {
      const p = g.partition;
      push({
        key: "partition",
        title: "Storage partition (interior)",
        sub: `${fmtFtIn(p.depth)} from the ${p.end} end · seen from the front`,
        faceW: W,
        gable: true,
        eave: H,
        peak,
        h: gableH,
        items: p.items.map((it, i) => ({ x: e8(it.x) / 96, w: e8(it.w) / 96, h: e8(it.h || it.w) / 96, sill: e8(it.yo || 0) / 96, type: it.type, role: progRole(it.type), id: "p" + i })),
        ends: ["LEFT EAVE", "RIGHT EAVE"],
        truss: [],
        oc: 0,
        open: false,
        side: [],
        foot: []
      });
    }
    push({
      key: "right",
      title: "Right eave",
      sub: "seen from outside",
      faceW: L,
      gable: false,
      eave: H,
      peak: H,
      h: flatH,
      items: on("right"),
      ends: ["FRONT GABLE", "BACK GABLE"],
      truss: tFront,
      oc,
      open: carport || !!open.right,
      side: gableLTs.map((l) => ltSide(l, l.k === "front")),
      foot: eaveLTs.filter((l) => l.k === "right").map((l) => ltFoot(l, l.start))
    });
    push({
      key: "left",
      title: "Left eave",
      sub: "seen from outside",
      faceW: L,
      gable: false,
      eave: H,
      peak: H,
      h: flatH,
      items: on("left"),
      ends: ["BACK GABLE", "FRONT GABLE"],
      truss: tFront.map((t) => L - t),
      oc,
      open: carport || !!open.left,
      side: gableLTs.map((l) => ltSide(l, l.k === "back")),
      foot: eaveLTs.filter((l) => l.k === "left").map((l) => ltFoot(l, L - l.start - l.len))
    });
    lts.forEach((l) => leanToSpecs(l, tFront, oc).forEach(push));
    return out;
  }
  function progRole(t) {
    return t === "rollup" ? "rollup" : t === "wtd" ? "walk" : t === "win" ? "window" : "framed";
  }
  function ltWallH(part, x) {
    const d = part.lowAtZero ? x : part.len - x;
    return part.low + Math.max(0, Math.min(part.len, d)) * part.slope;
  }
  function leanToSpecs(l, tFront = [], oc = 0) {
    const eave = l.k === "left" || l.k === "right";
    const part = l.part || { len: l.w, low: l.low, slope: (l.pitch || 0) / 12, lowAtZero: l.k === "right" || l.k === "front" };
    const mirror = l.k === "left" || l.k === "front";
    const byLoc = { outer: [], front: [], back: [], partition: [] };
    const tbd = { outer: [], front: [], back: [], partition: [] };
    (l.openings || []).forEach((o, oi) => {
      const loc = byLoc[o.loc] ? o.loc : "outer";
      const w = e8(o.w) / 96, h = e8(o.h) / 96, sill = e8(o.sill || 0) / 96;
      const ok = Array.isArray(o.xs) && o.xs.length === (o.qty || o.xs.length) && o.xs.every((v) => isFinite(v)) && w > 0;
      const name = o.label || ({ rollup: "Roll-up door", wtd: "Walk door", win: "Window", fo: "Framed opening" }[o.type] || "Opening");
      if (!ok) {
        tbd[loc].push(`${o.qty > 1 ? o.qty + "× " : ""}${name}${w > 0 ? " " + fmtFtIn(w) + " × " + fmtFtIn(h) : ""} — position TBD (the quote has no spot for it)`);
        return;
      }
      o.xs.forEach((x0, i) => {
        const x = e8(x0) / 96;
        const run = loc === "outer" ? l.len : part.len;
        const xd = loc === "outer" && mirror ? (e8(run) - e8(x) - e8(w)) / 96 : x;
        byLoc[loc].push({ x: xd, w, h, sill, type: o.type, role: progRole(o.type), id: `lt${l.n}-${oi}-${i}`, name });
      });
    });
    const specs = [];
    const lt = `Lean-to ${l.n}`;
    const where = `${SIDE_LT_NAME[l.k]} · ${fmtFtIn(l.w)} × ${fmtFtIn(l.len)} · ${fmtFtIn(l.low)} low eave`;
    const runEnds = eave ? l.k === "left" ? ["BACK END", "FRONT END"] : ["FRONT END", "BACK END"] : l.k === "front" ? ["LEFT EAVE END", "RIGHT EAVE END"] : ["RIGHT EAVE END", "LEFT EAVE END"];
    let truss = [];
    if (eave) {
      truss = tFront.filter((t) => t > l.start + 1e-6 && t < l.start + l.len - 1e-6).map((t) => mirror ? l.start + l.len - t : t - l.start);
    }
    let storX = null;
    if (l.stor && eave) storX = mirror ? l.start + l.len - l.stor.at : l.stor.at - l.start;
    specs.push({
      key: `lt${l.n}-outer`,
      lt: l.n,
      title: `${lt} · outer wall`,
      sub: where,
      faceW: l.len,
      gable: false,
      eave: l.low,
      peak: l.low,
      h: () => l.low,
      items: byLoc.outer,
      ends: runEnds,
      truss,
      oc: eave ? oc : 0,
      open: l.walls ? l.walls.side !== "closed" : false,
      side: [],
      foot: [],
      storX,
      notes: tbd.outer
    });
    const ends = part.lowAtZero ? ["OUTER POST", "MAIN WALL"] : ["MAIN WALL", "OUTER POST"];
    const endName = eave ? { front: "front end wall", back: "back end wall" } : { front: "right-eave end wall", back: "left-eave end wall" };
    for (const loc of ["front", "back"]) {
      specs.push({
        key: `lt${l.n}-${loc}`,
        lt: l.n,
        title: `${lt} · ${endName[loc]}`,
        sub: where,
        faceW: part.len,
        gable: false,
        sloped: true,
        eave: part.low,
        peak: Math.max(ltWallH(part, 0), ltWallH(part, part.len)),
        h: (x) => ltWallH(part, x),
        items: byLoc[loc],
        ends,
        truss: [],
        oc: 0,
        open: l.walls ? l.walls[loc] !== "closed" : false,
        side: [],
        foot: [],
        notes: tbd[loc]
      });
    }
    if (l.stor) {
      specs.push({
        key: `lt${l.n}-partition`,
        lt: l.n,
        title: `${lt} · storage partition`,
        sub: `${fmtFtIn(l.stor.len)} storage at the ${l.stor.end} end · ${SIDE_LT_NAME[l.k]}`,
        faceW: part.len,
        gable: false,
        sloped: true,
        eave: part.low,
        peak: Math.max(ltWallH(part, 0), ltWallH(part, part.len)),
        h: (x) => ltWallH(part, x),
        items: byLoc.partition,
        ends,
        truss: [],
        oc: 0,
        open: false,
        side: [],
        foot: [],
        notes: tbd.partition
      });
    } else if (tbd.partition.length) {
      specs[0].notes = specs[0].notes.concat(tbd.partition);
    }
    return specs;
  }
  function elevLayout(spec, { VW = 740, maxH = 150, mL = 30, mR = 86, mT = 30 } = {}) {
    let extL = 0, extR = 0;
    (spec.side || []).forEach((q) => {
      if (q.onLeft) extL = Math.max(extL, q.w);
      else extR = Math.max(extR, q.w);
    });
    (spec.items || []).forEach((it) => {
      extL = Math.max(extL, -it.x);
      extR = Math.max(extR, it.x + it.w - spec.faceW);
    });
    const span = spec.faceW + extL + extR;
    const top = Math.max(spec.peak || 0, spec.eave || 0, 1);
    const s = Math.min((VW - mL - mR) / (span || 1), maxH / top);
    const ox = mL + (VW - mL - mR - span * s) / 2 + extL * s;
    const gy = mT + top * s;
    const segs = chain(spec.items, spec.faceW);
    const X = (ft) => ox + ft * s;
    const rows = chainRows(segs, (n) => X(n / EIGHTHS));
    const usedRows = rows.reduce((m, r) => Math.max(m, r.row), -1);
    const dy = gy + 20;
    const rowY = (row) => row === 0 ? dy - 5 : row === 1 ? dy + 13 : row === 2 ? dy + 25 : dy + 37;
    const below = segs.length ? usedRows >= 2 ? 40 : 26 : 0;
    const dy2 = segs.length ? dy + below + 14 : gy + 22;
    const VH = Math.round(dy2 + 28);
    return { s, ox, gy, dy, dy2, VH, VW, X, Y: (h) => gy - h * s, rows, rowY, segs, extL, extR };
  }
  function paginate(heights, avail, signH, maxPer = 3, p1Room = 0) {
    const pages = [];
    let cur = [], used = 0;
    heights.forEach((h, i) => {
      if (cur.length && (cur.length >= maxPer || used + h > avail)) {
        pages.push(cur);
        cur = [];
        used = 0;
      }
      cur.push(i);
      used += h;
    });
    if (cur.length) pages.push(cur);
    if (!pages.length) {
      if (signH <= p1Room) return { pages: [], signOnP1: true };
      return { pages: [["sign"]], signOnP1: false };
    }
    const last = pages[pages.length - 1];
    const lastUsed = last.reduce((t, i) => t + heights[i], 0);
    if (lastUsed + signH <= avail) last.push("sign");
    else if (last.length >= 2 && heights[last[last.length - 1]] + signH <= avail) pages.push([last.pop(), "sign"]);
    else pages.push(["sign"]);
    return { pages, signOnP1: false };
  }

  // layout-src/SheetDoc.jsx
  var R = window.React;
  var TYPE_HEX = {
    rollup: "#f0883e",
    walk: "#14A6A0",
    double: "#0E7A76",
    window: "#36598F",
    sliding: "#14A269",
    framed: "#5A6A7E",
    custom: "#1A3556"
  };
  var ROLE_HEX = { rollup: "#f0883e", walk: "#14A6A0", window: "#36598F", framed: "#5A6A7E" };
  var INK = "#0B1F3A";
  var LINE = "#9AA9BB";
  var SOFT = "#C9D2DC";
  var MUTED = "#5A6A7E";
  var TEAL = "#14A6A0";
  var colorOf = (it) => TYPE_HEX[it.type] || ROLE_HEX[it.role] || "#5A6A7E";
  var PAGE_H = 1056;
  var PAGE_PAD_B = 16;
  var FOOT_H = 22;
  var CARD_W = 748;
  function PlanKey({ building, openings, tagMap, geom }) {
    const W = Number(building.width) || 0, L = Number(building.length) || 0;
    const g = geom && geom.W === W && geom.L === L ? geom : null;
    const lts = g && Array.isArray(g.leanTos) ? g.leanTos : [];
    const ext = { left: 0, right: 0, front: 0, back: 0 };
    lts.forEach((l) => {
      ext[l.k] = Math.max(ext[l.k], l.w);
    });
    const zSpan = L + ext.front + ext.back, xSpan = W + ext.left + ext.right;
    const VW = CARD_W, mL = 56, mR = 56, mT = 38, mB = 42;
    const s = Math.min((VW - mL - mR) / (zSpan || 1), 250 / (xSpan || 1));
    const oz = mL + (VW - mL - mR - zSpan * s) / 2 + ext.front * s;
    const ox = mT + ext.left * s;
    const VH = Math.round(mT + xSpan * s + mB);
    const PZ = (z) => +(oz + z * s).toFixed(1);
    const PX = (x) => +(ox + x * s).toFixed(1);
    const els = [];
    const hybrid = building.config === "hybrid", carport = building.config === "carport";
    const open = g && g.open || {};
    const wallOpen = {
      front: carport || (hybrid ? building.openEnd === "front" : !!open.front),
      back: carport || (hybrid ? building.openEnd === "back" : !!open.back),
      left: carport || !hybrid && !!open.left,
      right: carport || !hybrid && !!open.right
    };
    els.push(/* @__PURE__ */ React.createElement("rect", { key: "bf", x: PZ(0), y: PX(0), width: (L * s).toFixed(1), height: (W * s).toFixed(1), fill: "#F4F7FA", stroke: "none" }));
    trussFromFront(building, g).forEach((t, i) => els.push(
      /* @__PURE__ */ React.createElement("line", { key: "tr" + i, x1: PZ(t), y1: PX(0), x2: PZ(t), y2: PX(W), stroke: SOFT, strokeWidth: "0.8", strokeDasharray: "3 4" })
    ));
    lts.forEach((l) => {
      const r = ltRect(l, W, L);
      const x = PZ(r.z0), y = PX(r.x0), w = (r.z1 - r.z0) * s, h = (r.x1 - r.x0) * s;
      els.push(/* @__PURE__ */ React.createElement("rect", { key: "lt" + l.n, x, y, width: w.toFixed(1), height: h.toFixed(1), fill: "rgba(20,166,160,0.06)", stroke: TEAL, strokeWidth: "1", strokeDasharray: l.walls && l.walls.side === "closed" ? null : "5 3" }));
      if (l.stor) {
        const eave = l.k === "left" || l.k === "right";
        if (eave) els.push(/* @__PURE__ */ React.createElement("line", { key: "lts" + l.n, x1: PZ(l.stor.at), y1: y, x2: PZ(l.stor.at), y2: y + h, stroke: INK, strokeWidth: "1.2", strokeDasharray: "5 3" }));
        else {
          const d = l.k === "back" ? W - l.stor.at : l.stor.at;
          els.push(/* @__PURE__ */ React.createElement("line", { key: "lts" + l.n, x1: x, y1: PX(d), x2: x + w, y2: PX(d), stroke: INK, strokeWidth: "1.2", strokeDasharray: "5 3" }));
        }
      }
      const full = `LT${l.n} · ${fmtFtIn(l.w)} × ${fmtFtIn(l.len)} · ${fmtFtIn(l.low)} low eave${l.stor ? " · " + fmtFtIn(l.stor.len) + " storage (" + l.stor.end + ")" : ""}`;
      const short = `LT${l.n}`;
      let cxL = x + w / 2, cyL = y + h / 2, room = l.k === "left" || l.k === "right" ? w : h;
      if (l.stor) {
        if (l.k === "left" || l.k === "right") {
          const a = PZ(l.stor.at);
          const pick = a - x >= x + w - a ? [x, a] : [a, x + w];
          cxL = (pick[0] + pick[1]) / 2;
          room = pick[1] - pick[0];
        } else {
          const d = PX(l.k === "back" ? W - l.stor.at : l.stor.at);
          const pick = d - y >= y + h - d ? [y, d] : [d, y + h];
          cyL = (pick[0] + pick[1]) / 2;
        }
      }
      const fits = l.k === "left" || l.k === "right" ? full.length * 5.6 < room - 10 && h >= 16 : full.length * 5.6 < w - 10 && h >= 16;
      els.push(/* @__PURE__ */ React.createElement("text", { key: "ltt" + l.n, x: cxL.toFixed(1), y: (cyL + 3.5).toFixed(1), textAnchor: "middle", fontSize: "10", fontWeight: "600", fill: "#0E7A76", letterSpacing: ".02em" }, fits ? full : short));
      (l.openings || []).forEach((o, oi) => {
        if (!Array.isArray(o.xs)) return;
        o.xs.forEach((xx, i) => {
          const p = ltOpeningPlan(l, o.loc, xx, o.w, W, L);
          els.push(/* @__PURE__ */ React.createElement("line", { key: `lto${l.n}-${oi}-${i}`, x1: PZ(p.z0), y1: PX(p.x0), x2: PZ(p.z1), y2: PX(p.x1), stroke: ROLE_HEX[roleOf(o.type)], strokeWidth: "3.4", strokeLinecap: "butt" }));
        });
      });
    });
    if (hybrid && window.hasDivider && window.hasDivider(building)) {
      const z = L - window.dividerLengthPos(building);
      els.push(/* @__PURE__ */ React.createElement("line", { key: "div", x1: PZ(z), y1: PX(0), x2: PZ(z), y2: PX(W), stroke: INK, strokeWidth: "1.4", strokeDasharray: "5 3" }));
    }
    if (g && g.partition) {
      const p = g.partition;
      if (p.kind === "x") els.push(/* @__PURE__ */ React.createElement("line", { key: "pt", x1: PZ(0), y1: PX(p.at), x2: PZ(L), y2: PX(p.at), stroke: INK, strokeWidth: "1.2", strokeDasharray: "5 3" }));
      else {
        els.push(/* @__PURE__ */ React.createElement("line", { key: "pt", x1: PZ(p.at), y1: PX(0), x2: PZ(p.at), y2: PX(W), stroke: INK, strokeWidth: "1.2", strokeDasharray: "5 3" }));
        (p.items || []).forEach((it, i) => els.push(/* @__PURE__ */ React.createElement("line", { key: "pti" + i, x1: PZ(p.at) + 3, y1: PX(it.x), x2: PZ(p.at) + 3, y2: PX(it.x + it.w), stroke: ROLE_HEX[roleOf(it.type)], strokeWidth: "3.4" })));
      }
    }
    const WL = { front: [PZ(0), PX(0), PZ(0), PX(W)], back: [PZ(L), PX(0), PZ(L), PX(W)], left: [PZ(0), PX(0), PZ(L), PX(0)], right: [PZ(0), PX(W), PZ(L), PX(W)] };
    Object.keys(WL).forEach((k) => {
      const [a, b, c, d] = WL[k];
      els.push(/* @__PURE__ */ React.createElement("line", { key: "w" + k, x1: a, y1: b, x2: c, y2: d, stroke: INK, strokeWidth: "1.4", strokeLinecap: "square", strokeDasharray: wallOpen[k] ? "6 4" : null }));
    });
    const divZ = hybrid && window.dividerLengthPos ? L - window.dividerLengthPos(building) : null;
    (openings || []).forEach((op) => {
      let seg, out;
      const o = op.offset, w = op.w;
      if (op.wall === "front") {
        seg = [0, o, 0, o + w];
        out = [-1, 0];
      } else if (op.wall === "back") {
        seg = [L, o, L, o + w];
        out = [1, 0];
      } else if (op.wall === "left") {
        seg = [L - o - w, 0, L - o, 0];
        out = [0, -1];
      } else if (op.wall === "right") {
        seg = [L - o - w, W, L - o, W];
        out = [0, 1];
      } else if (op.wall === "divider" && divZ != null) {
        seg = [divZ, o, divZ, o + w];
        out = [1, 0];
      } else return;
      const col = TYPE_HEX[op.type] || MUTED;
      els.push(/* @__PURE__ */ React.createElement("line", { key: "op" + op.id, x1: PZ(seg[0]), y1: PX(seg[1]), x2: PZ(seg[2]), y2: PX(seg[3]), stroke: col, strokeWidth: "4" }));
      const tag = tagMap[op.id];
      if (tag) {
        const cz = PZ((seg[0] + seg[2]) / 2) + out[0] * 11, cx = PX((seg[1] + seg[3]) / 2) + out[1] * 11;
        const flip = op.wall === "left" && ext.left || op.wall === "right" && ext.right || op.wall === "front" && ext.front || op.wall === "back" && ext.back;
        const tz = flip ? PZ((seg[0] + seg[2]) / 2) - out[0] * 11 : cz, tx = flip ? PX((seg[1] + seg[3]) / 2) - out[1] * 11 : cx;
        els.push(/* @__PURE__ */ React.createElement("g", { key: "tg" + op.id }, /* @__PURE__ */ React.createElement("circle", { cx: tz, cy: tx, r: "7", fill: col }), /* @__PURE__ */ React.createElement("text", { x: tz, y: tx + 3.3, textAnchor: "middle", fontSize: "9", fontWeight: "700", fill: "#fff" }, tag)));
      }
    });
    const lbl = (k, x, y, t, rot, anchor = "middle") => els.push(
      /* @__PURE__ */ React.createElement("text", { key: k, x, y, textAnchor: anchor, fontSize: "9", fontWeight: "600", fill: MUTED, letterSpacing: ".14em", transform: rot ? `rotate(${rot} ${x} ${y})` : null }, t)
    );
    const nT = ext.left ? 9 : 22, nB = ext.right ? 16 : 30, nF = ext.front ? 12 : 26, nK = ext.back ? 14 : 28;
    lbl("nl", (PZ(0) + PZ(L)) / 2, PX(-ext.left) - nT, `LEFT EAVE${ext.left ? " SIDE" : ""} · ${fmtFtIn(L)}`);
    lbl("nr", (PZ(0) + PZ(L)) / 2, PX(W + ext.right) + nB, `RIGHT EAVE${ext.right ? " SIDE" : ""} · ${fmtFtIn(L)}`);
    lbl("nf", PZ(-ext.front) - nF, (PX(0) + PX(W)) / 2, `FRONT · ${fmtFtIn(W)}`, -90);
    lbl("nb", PZ(L + ext.back) + nK, (PX(0) + PX(W)) / 2, `BACK · ${fmtFtIn(W)}`, 90);
    return /* @__PURE__ */ React.createElement("svg", { className: "plan-key", viewBox: `0 0 ${VW} ${VH}`, width: VW, height: VH, xmlns: "http://www.w3.org/2000/svg", fontFamily: "Inter, Barlow, Arial, sans-serif" }, els);
  }
  function roleOf(t) {
    return t === "rollup" ? "rollup" : t === "wtd" ? "walk" : t === "win" ? "window" : "framed";
  }
  function ElevationCard({ spec }) {
    const lay = elevLayout(spec);
    const { X, Y, gy, dy, dy2, VW, VH, s } = lay;
    const els = [];
    const F = spec.faceW;
    els.push(/* @__PURE__ */ React.createElement("line", { key: "gnd", x1: "8", y1: gy, x2: VW - 8, y2: gy, stroke: SOFT, strokeWidth: "1" }));
    (spec.side || []).forEach((q, i) => {
      const pts2 = q.onLeft ? [[-q.w, 0], [-q.w, q.low], [0, q.conn], [0, 0]] : [[F, 0], [F, q.conn], [F + q.w, q.low], [F + q.w, 0]];
      els.push(/* @__PURE__ */ React.createElement("polygon", { key: "sl" + i, points: pts2.map(([x, h]) => `${X(x).toFixed(1)},${Y(h).toFixed(1)}`).join(" "), fill: "rgba(20,166,160,0.05)", stroke: TEAL, strokeWidth: "1", strokeDasharray: "4 3" }));
      els.push(/* @__PURE__ */ React.createElement("text", { key: "slt" + i, x: X(q.onLeft ? -q.w / 2 : F + q.w / 2), y: Y(q.low / 2) + 3, textAnchor: "middle", fontSize: "9.5", fontWeight: "600", fill: "#0E7A76" }, q.label));
    });
    const pts = [];
    pts.push([0, 0], [0, spec.h(0)]);
    if (spec.gable) pts.push([F / 2, spec.h(F / 2)]);
    pts.push([F, spec.h(F)], [F, 0]);
    els.push(/* @__PURE__ */ React.createElement("polygon", { key: "wall", points: pts.map(([x, h]) => `${X(x).toFixed(1)},${Y(h).toFixed(1)}`).join(" "), fill: spec.open ? "none" : "#FAFBFC", stroke: INK, strokeWidth: "1.1", strokeLinejoin: "round", strokeDasharray: spec.open ? "6 4" : null }));
    if (spec.gable) els.push(/* @__PURE__ */ React.createElement("line", { key: "eave", x1: X(0), y1: Y(spec.eave), x2: X(F), y2: Y(spec.eave), stroke: SOFT, strokeWidth: "0.8", strokeDasharray: "4 4" }));
    if (spec.open) els.push(/* @__PURE__ */ React.createElement("text", { key: "ow", x: X(F / 2), y: Y(spec.eave) + 14, textAnchor: "middle", fontSize: "9.5", fill: MUTED }, "open wall"));
    (spec.truss || []).forEach((t, i) => {
      if (t <= 1e-6 || t >= F - 1e-6) return;
      els.push(/* @__PURE__ */ React.createElement("line", { key: "fl" + i, x1: X(t), y1: gy, x2: X(t), y2: Y(spec.h(t)), stroke: LINE, strokeWidth: "0.8", strokeDasharray: "3 4" }));
    });
    if ((spec.truss || []).length && spec.oc) els.push(/* @__PURE__ */ React.createElement("text", { key: "flt", x: X(F), y: Y(spec.h(F)) - 8, textAnchor: "end", fontSize: "10", fill: MUTED }, `frame lines ${fmtFtIn(spec.oc)} OC`));
    if (spec.storX != null) {
      els.push(/* @__PURE__ */ React.createElement("line", { key: "st", x1: X(spec.storX), y1: gy, x2: X(spec.storX), y2: Y(spec.eave), stroke: INK, strokeWidth: "1.2", strokeDasharray: "5 3" }));
      els.push(/* @__PURE__ */ React.createElement("text", { key: "stt", x: X(spec.storX) + 4, y: Y(spec.eave) + 11, fontSize: "8.5", fill: "#0E7A76" }, "storage partition"));
    }
    const sizeLabelY = (it, ry, rw, rh) => {
      const lw = (fmtFtIn(it.w).length + fmtFtIn(it.h).length + 1) * (rw < 52 ? 4.8 : 5.4);
      return rh >= 26 && rw >= lw + 4 ? ry + 12 : ry - 4;
    };
    const legend = [];
    const busy = spec.items.flatMap((it) => {
      const rx = X(it.x), ry = Y(it.sill + it.h), rw = it.w * s, rh = it.h * s;
      const lw = (fmtFtIn(it.w).length + fmtFtIn(it.h).length + 1) * 6;
      const ly = sizeLabelY(it, ry, rw, rh);
      return [{ x0: rx - 18, x1: rx + rw, y0: ry, y1: ry + rh }, { x0: rx + rw / 2 - lw / 2, x1: rx + rw / 2 + lw / 2, y0: ly - 10, y1: ly + 2 }];
    });
    if ((spec.truss || []).length && spec.oc) busy.push({ x0: X(F) - 110, x1: X(F), y0: Y(spec.h(F)) - 18, y1: Y(spec.h(F)) - 4 });
    const clear = (b) => busy.every((q) => b.x1 <= q.x0 || b.x0 >= q.x1 || b.y1 <= q.y0 || b.y0 >= q.y1);
    (spec.foot || []).forEach((f, i) => {
      els.push(/* @__PURE__ */ React.createElement("rect", { key: "ft" + i, x: X(f.x0), y: Y(f.h), width: (f.len * s).toFixed(1), height: (f.h * s).toFixed(1), fill: "rgba(20,166,160,0.05)", stroke: TEAL, strokeWidth: "1", strokeDasharray: "5 4" }));
      const spots = [Y(f.h) - 4, Y(0) - 5, Y(f.h) + 13];
      const tryText = (txt2) => {
        const tw = txt2.length * 5.8;
        if (tw > f.len * s - 8 && spots.length) return null;
        for (const y2 of spots) {
          const b = { x0: X(f.x0) + 5, x1: X(f.x0) + 5 + tw, y0: y2 - 10, y1: y2 + 2 };
          if (clear(b)) {
            busy.push(b);
            return y2;
          }
        }
        return null;
      };
      let txt = f.label, y = tryText(txt);
      if (y == null) {
        txt = f.label.split(" · ")[0];
        y = tryText(txt);
        legend.push(f.label);
      }
      if (y == null) y = Y(f.h) - 4;
      els.push(/* @__PURE__ */ React.createElement("text", { key: "ftt" + i, x: X(f.x0) + 5, y, fontSize: "9.5", fontWeight: "600", fill: "#0E7A76" }, txt));
    });
    const items = spec.items.slice().sort((a, b) => a.x - b.x);
    items.forEach((it) => {
      const col = colorOf(it);
      const rx = X(it.x), ry = Y(it.sill + it.h), rw = it.w * s, rh = it.h * s;
      const pid = "h-" + (it.type || it.role);
      els.push(/* @__PURE__ */ React.createElement("rect", { key: "o" + it.id, x: rx.toFixed(1), y: ry.toFixed(1), width: rw.toFixed(1), height: rh.toFixed(1), fill: `url(#${pid})`, stroke: col, strokeWidth: "1.1", strokeDasharray: "4 2.5" }));
      const lab = `${fmtFtIn(it.w)}×${fmtFtIn(it.h)}`;
      const fs = rw < 52 ? 8.5 : 9.5;
      const ly = sizeLabelY(it, ry, rw, rh);
      els.push(/* @__PURE__ */ React.createElement("text", { key: "ol" + it.id, x: (rx + rw / 2).toFixed(1), y: ly.toFixed(1), textAnchor: "middle", fontSize: fs, fontWeight: "600", fill: INK, className: "op-size" }, lab));
      if (it.sill > 0.1) els.push(/* @__PURE__ */ React.createElement("text", { key: "os" + it.id, x: (rx + rw / 2).toFixed(1), y: ((Y(0) + Y(it.sill)) / 2 + 3).toFixed(1), textAnchor: "middle", fontSize: "8.5", fill: MUTED, className: "op-sill" }, `sill ${fmtFtIn(it.sill)}`));
      if (it.tag) {
        const cx = rx - 9, cy = ry + Math.min(rh / 2, Math.max(rh - 8, 8));
        els.push(/* @__PURE__ */ React.createElement("g", { key: "otg" + it.id }, /* @__PURE__ */ React.createElement("circle", { cx: cx.toFixed(1), cy: cy.toFixed(1), r: "6.5", fill: col }), /* @__PURE__ */ React.createElement("text", { x: cx.toFixed(1), y: (cy + 3).toFixed(1), textAnchor: "middle", fontSize: "8.5", fontWeight: "700", fill: "#fff" }, it.tag)));
      }
    });
    const hR = spec.h(F), dx = X(F + lay.extR) + 16;
    els.push(/* @__PURE__ */ React.createElement("g", { key: "leg" }, /* @__PURE__ */ React.createElement("line", { x1: dx, y1: Y(0), x2: dx, y2: Y(hR), stroke: LINE, strokeWidth: "1" }), /* @__PURE__ */ React.createElement("line", { x1: dx - 4, y1: Y(0), x2: dx + 4, y2: Y(0), stroke: LINE, strokeWidth: "1" }), /* @__PURE__ */ React.createElement("line", { x1: dx - 4, y1: Y(hR), x2: dx + 4, y2: Y(hR), stroke: LINE, strokeWidth: "1" }), /* @__PURE__ */ React.createElement("text", { x: dx + 7, y: (Y(0) + Y(hR)) / 2 + 4, fontSize: "10.5", fontWeight: "600", fill: INK }, `${fmtFtIn(hR)} ${spec.sloped ? "" : "leg"}`.trim())));
    if (spec.sloped) els.push(/* @__PURE__ */ React.createElement("text", { key: "h0", x: X(0) - 6, y: Y(spec.h(0)) + 4, textAnchor: "end", fontSize: "10", fontWeight: "600", fill: INK }, fmtFtIn(spec.h(0))));
    if (spec.gable) {
      const pitch = typeof spec.peak === "number" ? spec.peak : 0;
      els.push(/* @__PURE__ */ React.createElement("text", { key: "pk", x: X(F / 2), y: Y(pitch) - 8, textAnchor: "middle", fontSize: "9.5", fill: MUTED }, `peak ${fmtFtIn(pitch)}`));
    }
    if (lay.segs.length) {
      const a0 = lay.segs[0].a, a1 = lay.segs[lay.segs.length - 1].b;
      els.push(/* @__PURE__ */ React.createElement("line", { key: "ch", x1: X(a0 / 96), y1: dy, x2: X(a1 / 96), y2: dy, stroke: LINE, strokeWidth: "1" }));
      const stops = Array.from(new Set(lay.segs.flatMap((sg) => [sg.a, sg.b])));
      stops.forEach((t) => els.push(/* @__PURE__ */ React.createElement("line", { key: "ck" + t, x1: X(t / 96), y1: dy - 4, x2: X(t / 96), y2: dy + 4, stroke: LINE, strokeWidth: "1" })));
      lay.rows.forEach((r, i) => els.push(
        /* @__PURE__ */ React.createElement(
          "text",
          {
            key: "cl" + i,
            x: r.cx.toFixed(1),
            y: lay.rowY(r.row).toFixed(1),
            textAnchor: "middle",
            fontSize: "9.5",
            fontWeight: r.kind === "width" ? 700 : 400,
            fill: r.kind === "width" ? INK : MUTED,
            className: "ch-" + r.kind,
            "data-e8": r.d
          },
          r.text
        )
      ));
    }
    els.push(/* @__PURE__ */ React.createElement("g", { key: "ov" }, /* @__PURE__ */ React.createElement("line", { x1: X(0), y1: dy2, x2: X(F), y2: dy2, stroke: LINE, strokeWidth: "1" }), /* @__PURE__ */ React.createElement("line", { x1: X(0), y1: dy2 - 5, x2: X(0), y2: dy2 + 5, stroke: LINE, strokeWidth: "1" }), /* @__PURE__ */ React.createElement("line", { x1: X(F), y1: dy2 - 5, x2: X(F), y2: dy2 + 5, stroke: LINE, strokeWidth: "1" }), /* @__PURE__ */ React.createElement("rect", { x: X(F / 2) - 30, y: dy2 - 8, width: "60", height: "16", fill: "#fff" }), /* @__PURE__ */ React.createElement("text", { x: X(F / 2), y: dy2 + 4.5, textAnchor: "middle", fontSize: "12", fontWeight: "700", fill: INK, className: "ch-total" }, fmtFtIn(F)), /* @__PURE__ */ React.createElement("text", { x: X(0), y: dy2 + 18, fontSize: "8.5", fontWeight: "600", fill: MUTED, letterSpacing: ".14em" }, spec.ends[0]), /* @__PURE__ */ React.createElement("text", { x: X(F), y: dy2 + 18, textAnchor: "end", fontSize: "8.5", fontWeight: "600", fill: MUTED, letterSpacing: ".14em" }, spec.ends[1])));
    const types = Array.from(new Set(items.map((it) => it.type || it.role)));
    return /* @__PURE__ */ React.createElement("div", { className: "elev-card", "data-elev": spec.key }, /* @__PURE__ */ React.createElement("div", { className: "elev-head" }, /* @__PURE__ */ React.createElement("span", { className: "elev-title" }, spec.title), /* @__PURE__ */ React.createElement("span", { className: "elev-sub" }, spec.sub), /* @__PURE__ */ React.createElement("span", { className: "elev-meta" }, `${items.length} opening${items.length === 1 ? "" : "s"}`)), /* @__PURE__ */ React.createElement("svg", { className: "elev-svg", viewBox: `0 0 ${VW} ${VH}`, width: CARD_W, height: Math.round(VH * CARD_W / VW), xmlns: "http://www.w3.org/2000/svg", fontFamily: "Inter, Barlow, Arial, sans-serif" }, /* @__PURE__ */ React.createElement("defs", null, types.map((t) => {
      const col = TYPE_HEX[t] || ROLE_HEX[t] || MUTED;
      return /* @__PURE__ */ React.createElement("pattern", { key: t, id: "h-" + t, width: "5", height: "5", patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" }, /* @__PURE__ */ React.createElement("line", { x1: "0", y1: "0", x2: "0", y2: "5", stroke: col, strokeOpacity: "0.35", strokeWidth: "0.8" }));
    })), els), (spec.notes || []).concat(legend).length > 0 && /* @__PURE__ */ React.createElement("div", { className: "elev-notes" }, (spec.notes || []).concat(legend).map((n, i) => /* @__PURE__ */ React.createElement("div", { key: i }, n))));
  }
  function MiniHead({ docInfo, revisionMode, page, total }) {
    return /* @__PURE__ */ React.createElement("div", { className: "mini-head" }, /* @__PURE__ */ React.createElement("div", { className: "wordmark" }, /* @__PURE__ */ React.createElement("span", null, "STORM"), /* @__PURE__ */ React.createElement("span", { className: "t" }, "SAFE"), /* @__PURE__ */ React.createElement("span", null, " STEEL")), /* @__PURE__ */ React.createElement("div", { className: "mini-meta" }, /* @__PURE__ */ React.createElement("span", null, revisionMode ? "Revised Layout Approval" : "Building Approval Sheet"), docInfo.customer ? /* @__PURE__ */ React.createElement("span", null, docInfo.customer) : null, docInfo.quoteNo ? /* @__PURE__ */ React.createElement("span", { className: "mono" }, docInfo.quoteNo) : null, /* @__PURE__ */ React.createElement("span", null, "Elevations · page ", page, " of ", total)));
  }
  function PageFoot({ page, total }) {
    return /* @__PURE__ */ React.createElement("div", { className: "page-foot" }, /* @__PURE__ */ React.createElement("span", null, "All dimensions to the opening edge, measured along grade from the wall corners · feet-inches to the nearest ⅛″"), /* @__PURE__ */ React.createElement("span", null, "Page ", page, " of ", total));
  }
  function SheetDoc(props) {
    const { building, docInfo, openings, tagMap, style, revisionMode } = props;
    const geom = docInfo && docInfo.geom ? docInfo.geom : null;
    const specs = elevationSpecs(building, openings, geom, tagMap);
    const sizeMismatch = geom && (geom.W !== Number(building.width) || geom.L !== Number(building.length));
    const notesB = { ...building, notes: (building.notes || []).concat(sizeMismatch ? ["The quote’s lean-tos / partitions are not drawn: the building size was changed here from the quote’s " + fmtFtIn(geom.W) + " × " + fmtFtIn(geom.L) + "."] : []) };
    const planLegend = (geom && !sizeMismatch && Array.isArray(geom.leanTos) ? geom.leanTos : []).map((l) => `LT${l.n} · ${{ left: "Left eave", right: "Right eave", front: "Front gable", back: "Back gable" }[l.k] || l.side} · ${fmtFtIn(l.w)} W × ${fmtFtIn(l.len)} L · ${fmtFtIn(l.low)} low eave${l.stor ? " · " + fmtFtIn(l.stor.len) + " storage at the " + l.stor.end + " end" : ""} · ${(l.walls && l.walls.mode) === "enclosed" ? "enclosed" : (l.walls && l.walls.mode) === "custom" ? "custom walls" : "open"}`);
    const stageRef = R.useRef(null);
    const [plan, setPlan] = R.useState(null);
    const H = window.SheetParts;
    const cards = specs.map((sp) => /* @__PURE__ */ React.createElement(ElevationCard, { key: sp.key, spec: sp }));
    const sign = /* @__PURE__ */ React.createElement("div", { className: "sign-block" }, revisionMode && H.RevChanges(), H.SignOff({ revisionMode }));
    const p1Core = (sched) => /* @__PURE__ */ React.createElement(React.Fragment, null, H.Masthead({ revisionMode }), H.InfoStrip({ docInfo }), revisionMode && H.RevStrip(), H.SpecBand({ building, docInfo }), /* @__PURE__ */ React.createElement("div", { className: "block-title" }, /* @__PURE__ */ React.createElement("h2", null, "Building Plan"), /* @__PURE__ */ React.createElement("span", { className: "hint" }, "Top view · lean-tos, frame lines and openings to scale · tags match the schedule")), /* @__PURE__ */ React.createElement("div", { className: "plan-key-wrap" }, /* @__PURE__ */ React.createElement(PlanKey, { building, openings, tagMap, geom }), planLegend.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "plan-legend" }, planLegend.map((t, i) => /* @__PURE__ */ React.createElement("span", { key: i }, t)))), /* @__PURE__ */ React.createElement("div", { className: "block-title" }, /* @__PURE__ */ React.createElement("h2", null, "Opening Schedule"), /* @__PURE__ */ React.createElement("span", { className: "hint" }, specs.length ? "Elevations follow · tags match the plan" : "Tags match the plan")), sched);
    const schedFull = /* @__PURE__ */ React.createElement(window.Schedule, { building: notesB, openings, tagMap });
    const schedBare = /* @__PURE__ */ React.createElement(window.Schedule, { building: { ...notesB, notes: [] }, openings, tagMap });
    const notesBlock = notesB.notes && notesB.notes.length ? /* @__PURE__ */ React.createElement("div", { className: "notes-block" }, /* @__PURE__ */ React.createElement("div", { className: "block-title" }, /* @__PURE__ */ React.createElement("h2", null, "Quote Notes"), /* @__PURE__ */ React.createElement("span", { className: "hint" }, "Continued from page 1")), /* @__PURE__ */ React.createElement("table", { className: "sched" }, /* @__PURE__ */ React.createElement("tbody", { className: "sched-notes" }, notesB.notes.map((n, i) => /* @__PURE__ */ React.createElement("tr", { key: i }, /* @__PURE__ */ React.createElement("td", null, n)))))) : null;
    const sig = JSON.stringify([specs.map((s) => [s.key, s.items.length]), openings.length, notesB.notes, revisionMode, docInfo.customer, docInfo.address, docInfo.quoteNo, building.width, building.length]);
    R.useLayoutEffect(() => {
      const st = stageRef.current;
      if (!st) return;
      const hOf = (sel) => {
        const el = st.querySelector(sel);
        return el ? el.getBoundingClientRect().height : 0;
      };
      const avail1 = PAGE_H - PAGE_PAD_B - FOOT_H;
      const core = hOf('[data-stage="p1"]');
      const notesH = hOf('[data-stage="notes"]'), notesRowsH = notesH - hOf('[data-stage="notes"] .block-title');
      const signH = hOf('[data-stage="sign"]') + 12;
      const hasNotes = !!(notesB.notes && notesB.notes.length);
      const notesOnP1 = !hasNotes || core + notesRowsH <= avail1;
      const p1Room = avail1 - core - (hasNotes && notesOnP1 ? notesRowsH : 0);
      const headH = hOf('[data-stage="mini"]');
      const availN = PAGE_H - PAGE_PAD_B - FOOT_H - headH - 8;
      const ids = [...notesOnP1 ? [] : ["notes"], ...specs.map((_, i) => i)];
      const heights = ids.map((b) => b === "notes" ? notesH + 12 : hOf(`[data-stage="e-${specs[b].key}"]`) + 12);
      const pg = paginate(heights, availN, signH, 3, p1Room);
      const next = { notesOnP1, signOnP1: pg.signOnP1, pages: pg.pages.map((p) => p.map((i) => i === "sign" ? "sign" : ids[i])) };
      const k = JSON.stringify(next);
      if (!plan || plan.k !== k || plan.sig !== sig) setPlan({ ...next, k, sig });
    });
    const ready = plan && plan.sig === sig;
    const pages = ready ? plan.pages : [];
    const total = 1 + pages.length;
    const docCls = "sheet-doc style-" + style;
    return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: docCls }, /* @__PURE__ */ React.createElement("div", { className: "sheet sheet-page p1 style-" + style }, p1Core(ready && !plan.notesOnP1 ? schedBare : schedFull), ready && plan.signOnP1 && sign, /* @__PURE__ */ React.createElement("div", { className: "page-fill" }), /* @__PURE__ */ React.createElement(PageFoot, { page: 1, total })), pages.map((blk, pi) => /* @__PURE__ */ React.createElement("div", { key: pi, className: "sheet sheet-page pn style-" + style }, /* @__PURE__ */ React.createElement(MiniHead, { docInfo, revisionMode, page: pi + 2, total }), blk.map((b) => b === "sign" ? /* @__PURE__ */ React.createElement(R.Fragment, { key: "sign" }, sign) : b === "notes" ? /* @__PURE__ */ React.createElement(R.Fragment, { key: "notes" }, notesBlock) : /* @__PURE__ */ React.createElement(R.Fragment, { key: specs[b].key }, cards[b])), /* @__PURE__ */ React.createElement("div", { className: "page-fill" }), /* @__PURE__ */ React.createElement(PageFoot, { page: pi + 2, total })))), /* @__PURE__ */ React.createElement("div", { className: "sheet-stage", ref: stageRef, "aria-hidden": "true" }, /* @__PURE__ */ React.createElement("div", { className: "sheet stage-sheet style-" + style, "data-stage": "p1" }, p1Core(schedBare)), /* @__PURE__ */ React.createElement("div", { className: "sheet stage-sheet style-" + style }, /* @__PURE__ */ React.createElement("div", { "data-stage": "notes" }, notesBlock), /* @__PURE__ */ React.createElement("div", { "data-stage": "mini" }, /* @__PURE__ */ React.createElement(MiniHead, { docInfo, revisionMode, page: 2, total: 2 })), /* @__PURE__ */ React.createElement("div", { "data-stage": "sign" }, sign), specs.map((sp, i) => /* @__PURE__ */ React.createElement("div", { key: sp.key, "data-stage": "e-" + sp.key }, cards[i])))));
  }
  window.SheetDoc = SheetDoc;
  window.SheetGeomFmt = fmtFtIn;
})();
