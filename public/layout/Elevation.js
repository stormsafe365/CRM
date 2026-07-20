function Elevation({
  building,
  openings,
  tagMap,
  wall = "front",
  blueprint = false,
  selectedId,
  onSelect,
  compact = false
}) {
  const gable = isGableWall(wall);
  const openGableWall = isOpenGable(building, wall);
  const openMode = openGableWall ? openGableMode(building) : null;
  const span = wallLength(wall, building);
  const eave = building.height;
  const peak = gable ? peakHeight(building) : eave;
  const totalH = gable ? peak : eave;
  const MAXW = compact ? 660 : 620;
  const MAXH = compact ? 150 : 220;
  const scale = Math.min(MAXW / span, MAXH / totalH);
  const PADX = 64, PADTOP = 30, PADBOT = 52;
  const bw = span * scale, bh = eave * scale, ph = peak * scale;
  const ox = PADX, groundY = PADTOP + ph;
  const right = ox + bw;
  const eaveY = groundY - bh;
  const peakY = groundY - ph;
  const svgW = bw + PADX * 2;
  const svgH = ph + PADTOP + PADBOT;
  const ink = blueprint ? "var(--steel-100)" : "var(--navy-900)";
  const wallFill = blueprint ? "var(--navy-900)" : "var(--steel-50)";
  const wallStroke = blueprint ? "var(--steel-200)" : "var(--navy-900)";
  const panelCol = blueprint ? "rgba(154,169,187,0.18)" : "var(--steel-200)";
  const dimCol = blueprint ? "var(--steel-400)" : "var(--steel-600)";
  const dimText = blueprint ? "var(--steel-200)" : "var(--navy-900)";
  const xAt = (ft) => ox + ft * scale;
  const yAt = (ft) => groundY - ft * scale;
  const els = [];
  if (gable) {
    if (openMode === "open") {
      els.push(/* @__PURE__ */ React.createElement(
        "polygon",
        {
          key: "wall",
          points: `${ox},${groundY} ${ox},${eaveY} ${ox + bw / 2},${peakY} ${right},${eaveY} ${right},${groundY}`,
          fill: "none",
          stroke: wallStroke,
          strokeWidth: "2",
          strokeLinejoin: "round",
          strokeDasharray: "7 4"
        }
      ));
      els.push(/* @__PURE__ */ React.createElement("line", { key: "eaveln", x1: ox, y1: eaveY, x2: right, y2: eaveY, stroke: wallStroke, strokeWidth: "1", opacity: "0.45", strokeDasharray: "4 4" }));
    } else if (openMode === "gable") {
      els.push(/* @__PURE__ */ React.createElement(
        "polygon",
        {
          key: "gable",
          points: `${ox},${eaveY} ${ox + bw / 2},${peakY} ${right},${eaveY}`,
          fill: wallFill,
          stroke: wallStroke,
          strokeWidth: "2.5",
          strokeLinejoin: "round"
        }
      ));
      els.push(/* @__PURE__ */ React.createElement("line", { key: "jl", x1: ox, y1: groundY, x2: ox, y2: eaveY, stroke: wallStroke, strokeWidth: "2", strokeDasharray: "6 4" }));
      els.push(/* @__PURE__ */ React.createElement("line", { key: "jr", x1: right, y1: groundY, x2: right, y2: eaveY, stroke: wallStroke, strokeWidth: "2", strokeDasharray: "6 4" }));
      els.push(/* @__PURE__ */ React.createElement("line", { key: "eaveln", x1: ox, y1: eaveY, x2: right, y2: eaveY, stroke: wallStroke, strokeWidth: "2" }));
    } else {
      els.push(/* @__PURE__ */ React.createElement(
        "polygon",
        {
          key: "wall",
          points: `${ox},${groundY} ${ox},${eaveY} ${ox + bw / 2},${peakY} ${right},${eaveY} ${right},${groundY}`,
          fill: wallFill,
          stroke: wallStroke,
          strokeWidth: "2.5",
          strokeLinejoin: "round"
        }
      ));
      els.push(/* @__PURE__ */ React.createElement("line", { key: "eaveln", x1: ox, y1: eaveY, x2: right, y2: eaveY, stroke: wallStroke, strokeWidth: "1", opacity: "0.45", strokeDasharray: "5 4" }));
    }
  } else {
    els.push(/* @__PURE__ */ React.createElement(
      "rect",
      {
        key: "wall",
        x: ox,
        y: eaveY,
        width: bw,
        height: bh,
        fill: wallFill,
        stroke: wallStroke,
        strokeWidth: "2.5"
      }
    ));
    els.push(/* @__PURE__ */ React.createElement("line", { key: "fascia", x1: ox - 8, y1: eaveY - 6, x2: right + 8, y2: eaveY - 6, stroke: wallStroke, strokeWidth: "2" }));
    els.push(/* @__PURE__ */ React.createElement("line", { key: "fl", x1: ox - 8, y1: eaveY - 6, x2: ox, y2: eaveY, stroke: wallStroke, strokeWidth: "1.5" }));
    els.push(/* @__PURE__ */ React.createElement("line", { key: "fr", x1: right + 8, y1: eaveY - 6, x2: right, y2: eaveY, stroke: wallStroke, strokeWidth: "1.5" }));
  }
  const panels = [];
  const step = Math.max(3, span / 24);
  const drawWallPanels = !openMode || openMode === "gable" && false;
  if (!openMode) {
    for (let f = step; f < span - 0.1; f += step) {
      panels.push(/* @__PURE__ */ React.createElement(
        "line",
        {
          key: "p" + f,
          x1: xAt(f),
          y1: groundY - 1,
          x2: xAt(f),
          y2: eaveY + 1,
          stroke: panelCol,
          strokeWidth: "1"
        }
      ));
    }
  }
  if (openMode === "gable") {
    for (let f = step; f < span - 0.1; f += step) {
      const x = xAt(f);
      const fx = f * scale;
      let yTopLine;
      if (fx <= bw / 2) yTopLine = eaveY + (peakY - eaveY) * (fx / (bw / 2));
      else yTopLine = peakY + (eaveY - peakY) * ((fx - bw / 2) / (bw / 2));
      if (eaveY - yTopLine > 2) {
        panels.push(/* @__PURE__ */ React.createElement(
          "line",
          {
            key: "pg" + f,
            x1: x,
            y1: yTopLine + 1,
            x2: x,
            y2: eaveY - 1,
            stroke: panelCol,
            strokeWidth: "1"
          }
        ));
      }
    }
  }
  els.push(/* @__PURE__ */ React.createElement("g", { key: "panels", opacity: blueprint ? 1 : 0.8 }, panels));
  (function() {
    const colCol = blueprint ? "rgba(154,169,187,0.45)" : "var(--steel-300)";
    const lt = building.legType;
    const stations = gable ? [0, span] : frameStations(span, building.trussOC);
    function post(cx, key) {
      const top = eaveY, bot = groundY;
      if (lt === "single") {
        return /* @__PURE__ */ React.createElement("line", { key, x1: cx, y1: top, x2: cx, y2: bot, stroke: colCol, strokeWidth: "2" });
      }
      if (lt === "double") {
        return /* @__PURE__ */ React.createElement("g", { key }, /* @__PURE__ */ React.createElement("line", { x1: cx - 2.5, y1: top, x2: cx - 2.5, y2: bot, stroke: colCol, strokeWidth: "1.6" }), /* @__PURE__ */ React.createElement("line", { x1: cx + 2.5, y1: top, x2: cx + 2.5, y2: bot, stroke: colCol, strokeWidth: "1.6" }));
      }
      const rungs = [];
      for (let yy = top + 10; yy < bot - 4; yy += 16) rungs.push(/* @__PURE__ */ React.createElement("line", { key: "r" + yy, x1: cx - 3.5, y1: yy, x2: cx + 3.5, y2: yy, stroke: colCol, strokeWidth: "1" }));
      return /* @__PURE__ */ React.createElement("g", { key }, /* @__PURE__ */ React.createElement("line", { x1: cx - 3.5, y1: top, x2: cx - 3.5, y2: bot, stroke: colCol, strokeWidth: "1.6" }), /* @__PURE__ */ React.createElement("line", { x1: cx + 3.5, y1: top, x2: cx + 3.5, y2: bot, stroke: colCol, strokeWidth: "1.6" }), rungs);
    }
    stations.forEach((p, i) => {
      let cx = xAt(p);
      if (i === 0) cx += 4;
      else if (i === stations.length - 1) cx -= 4;
      els.push(post(cx, "col" + i));
    });
  })();
  els.push(/* @__PURE__ */ React.createElement(
    "line",
    {
      key: "ground",
      x1: ox - 30,
      y1: groundY,
      x2: right + 30,
      y2: groundY,
      stroke: ink,
      strokeWidth: "2.5"
    }
  ));
  for (let i = 0; i < 16; i++) {
    const gx = ox - 26 + i * ((bw + 52) / 16);
    els.push(/* @__PURE__ */ React.createElement("line", { key: "h" + i, x1: gx, y1: groundY, x2: gx - 6, y2: groundY + 6, stroke: ink, strokeWidth: "1", opacity: "0.5" }));
  }
  const ops = openings.filter((o) => o.wall === wall).slice().sort((a, b) => a.offset - b.offset);
  ops.forEach((op) => {
    const t = OPENING_TYPES[op.type];
    const sel = op.id === selectedId;
    const x = xAt(op.offset);
    const wpx = op.w * scale;
    const sill = op.sill || 0;
    const top = sill + op.h;
    const yTop = yAt(top), yBot = yAt(sill);
    const hpx = yBot - yTop;
    els.push(
      /* @__PURE__ */ React.createElement(
        "g",
        {
          key: op.id,
          className: "op-grp",
          style: { cursor: onSelect ? "pointer" : "default" },
          onPointerDown: onSelect ? () => onSelect(op.id) : void 0
        },
        /* @__PURE__ */ React.createElement(
          "rect",
          {
            x,
            y: yTop,
            width: wpx,
            height: hpx,
            rx: "1.5",
            fill: t.color,
            fillOpacity: op.type === "window" ? 0.32 : 0.85,
            stroke: t.color,
            strokeWidth: "2"
          }
        ),
        op.type === "window" ? /* @__PURE__ */ React.createElement("line", { x1: x, y1: (yTop + yBot) / 2, x2: x + wpx, y2: (yTop + yBot) / 2, stroke: t.color, strokeWidth: "1.5" }) : /* @__PURE__ */ React.createElement("line", { x1: x + wpx / 2, y1: yTop + 3, x2: x + wpx / 2, y2: yBot - 3, stroke: "var(--white)", strokeWidth: "1", opacity: "0.6" }),
        /* @__PURE__ */ React.createElement("circle", { cx: x + wpx / 2, cy: yTop - 12, r: "9", fill: t.color, stroke: "var(--white)", strokeWidth: "1.5" }),
        /* @__PURE__ */ React.createElement(
          "text",
          {
            x: x + wpx / 2,
            y: yTop - 11.5,
            textAnchor: "middle",
            dominantBaseline: "central",
            fontFamily: "var(--font-mono)",
            fontWeight: "700",
            fontSize: "10",
            fill: "var(--white)"
          },
          tagMap[op.id]
        ),
        /* @__PURE__ */ React.createElement(
          "text",
          {
            x: x + wpx / 2,
            y: (yTop + yBot) / 2,
            textAnchor: "middle",
            dominantBaseline: "central",
            transform: hpx > wpx ? `rotate(-90 ${x + wpx / 2} ${(yTop + yBot) / 2})` : "",
            fontFamily: "var(--font-mono)",
            fontSize: "9.5",
            fontWeight: "600",
            fill: op.type === "window" ? t.color : "var(--white)"
          },
          ftInTight(op.h)
        ),
        sel && /* @__PURE__ */ React.createElement(
          "rect",
          {
            x: x - 4,
            y: yTop - 4,
            width: wpx + 8,
            height: hpx + 8,
            rx: "3",
            fill: "none",
            stroke: "var(--teal-500)",
            strokeWidth: "2",
            className: "op-sel-ring"
          }
        )
      )
    );
    if (op.type === "window" && sill > 0) {
      els.push(
        /* @__PURE__ */ React.createElement("g", { key: op.id + "-sill" }, /* @__PURE__ */ React.createElement("line", { x1: x - 6, y1: yBot, x2: x - 6, y2: groundY, stroke: dimCol, strokeWidth: "0.75" }), /* @__PURE__ */ React.createElement("line", { x1: x - 9, y1: yBot, x2: x - 3, y2: yBot, stroke: dimCol, strokeWidth: "1" }), /* @__PURE__ */ React.createElement(
          "text",
          {
            x: x - 11,
            y: (yBot + groundY) / 2,
            textAnchor: "middle",
            transform: `rotate(-90 ${x - 11} ${(yBot + groundY) / 2})`,
            fontFamily: "var(--font-mono)",
            fontSize: "9",
            fill: dimText
          },
          ftInTight(sill)
        ))
      );
    }
  });
  const dimX = right + 30;
  els.push(/* @__PURE__ */ React.createElement("line", { key: "hd", x1: dimX, y1: groundY, x2: dimX, y2: eaveY, stroke: dimCol, strokeWidth: "1" }));
  els.push(/* @__PURE__ */ React.createElement("line", { key: "hdt0", x1: dimX - 4, y1: groundY, x2: dimX + 4, y2: groundY, stroke: dimCol, strokeWidth: "1.25" }));
  els.push(/* @__PURE__ */ React.createElement("line", { key: "hdt1", x1: dimX - 4, y1: eaveY, x2: dimX + 4, y2: eaveY, stroke: dimCol, strokeWidth: "1.25" }));
  els.push(/* @__PURE__ */ React.createElement(
    "text",
    {
      key: "hdtxt",
      x: dimX + 13,
      y: (groundY + eaveY) / 2,
      textAnchor: "middle",
      transform: `rotate(-90 ${dimX + 13} ${(groundY + eaveY) / 2})`,
      fontFamily: "var(--font-mono)",
      fontSize: "10.5",
      fontWeight: "700",
      fill: dimText
    },
    ftInTight(eave),
    " EAVE"
  ));
  if (gable) {
    els.push(/* @__PURE__ */ React.createElement("line", { key: "pk", x1: ox + bw / 2, y1: peakY - 4, x2: ox + bw / 2, y2: eaveY, stroke: dimCol, strokeWidth: "0.75", strokeDasharray: "3 3", opacity: "0.7" }));
    els.push(/* @__PURE__ */ React.createElement(
      "text",
      {
        key: "pktxt",
        x: ox + bw / 2,
        y: peakY - 9,
        textAnchor: "middle",
        fontFamily: "var(--font-mono)",
        fontSize: "10",
        fontWeight: "600",
        fill: dimText
      },
      ftInTight(peak),
      " PEAK"
    ));
  }
  const subLabel = openMode === "gable" ? "\xA0\xB7\xA0Gable-Only Sheeting" : openMode === "open" ? "\xA0\xB7\xA0Open Carport End" : "";
  els.push(/* @__PURE__ */ React.createElement(
    "text",
    {
      key: "name",
      x: ox + bw / 2,
      y: groundY + 30,
      textAnchor: "middle",
      fontFamily: "var(--font-display)",
      fontWeight: "700",
      fontSize: "13",
      letterSpacing: "1.5",
      fill: ink,
      style: { textTransform: "uppercase" }
    },
    WALLS[wall].label,
    " ELEVATION\xA0\xA0\xB7\xA0\xA0",
    ftInTight(span),
    subLabel
  ));
  return /* @__PURE__ */ React.createElement(
    "svg",
    {
      viewBox: `0 0 ${svgW} ${svgH}`,
      role: "img",
      "aria-label": WALLS[wall].label + " elevation",
      style: { display: "block", width: "100%", height: "auto" }
    },
    els
  );
}
window.Elevation = Elevation;
