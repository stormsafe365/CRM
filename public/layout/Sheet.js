function Sheet({
  building,
  docInfo,
  openings,
  tagMap,
  style,
  showDims,
  showFrames = true,
  showElevation,
  elevWall,
  selectedId,
  onSelect,
  onMove,
  placeType,
  onPlace
}) {
  const blueprint = style === "blueprint";
  const today = docInfo.date && docInfo.date.trim() ? docInfo.date.trim() : "";
  const has = (s) => s && String(s).trim().length > 0;
  return /* @__PURE__ */ React.createElement("div", { className: "sheet style-" + style + (showElevation ? " has-elev" : "") }, /* @__PURE__ */ React.createElement("div", { className: "sheet-head" }, /* @__PURE__ */ React.createElement("div", { className: "brand" }, /* @__PURE__ */ React.createElement("div", { className: "wordmark" }, /* @__PURE__ */ React.createElement("span", null, "STORM"), /* @__PURE__ */ React.createElement("span", { className: "t" }, "SAFE"), /* @__PURE__ */ React.createElement("span", null, "\xA0STEEL")), /* @__PURE__ */ React.createElement("div", { className: "tagline" }, "Hurricane-Rated Steel Buildings")), /* @__PURE__ */ React.createElement("div", { className: "head-right" }, /* @__PURE__ */ React.createElement("div", { className: "masthead" }, "Building Approval Sheet"))), /* @__PURE__ */ React.createElement("div", { className: "info-strip" }, /* @__PURE__ */ React.createElement("div", { className: "info-cell" }, /* @__PURE__ */ React.createElement("div", { className: "k" }, "Customer"), /* @__PURE__ */ React.createElement("div", { className: "v" }, has(docInfo.customer) ? docInfo.customer : "\u2014")), has(docInfo.address) && /* @__PURE__ */ React.createElement("div", { className: "info-cell" }, /* @__PURE__ */ React.createElement("div", { className: "k" }, "Building Site Address"), /* @__PURE__ */ React.createElement("div", { className: "v", style: { fontWeight: 500, fontSize: "13px" } }, docInfo.address)), has(docInfo.quoteNo) && /* @__PURE__ */ React.createElement("div", { className: "info-cell" }, /* @__PURE__ */ React.createElement("div", { className: "k" }, "Quote No."), /* @__PURE__ */ React.createElement("div", { className: "v mono" }, docInfo.quoteNo), /* @__PURE__ */ React.createElement("div", { className: "v", style: { fontWeight: 500, fontSize: "12px", color: "var(--fg-3)", marginTop: "2px" } }, "Rev A", today ? " \xB7 " + today : "")), has(docInfo.rep) && /* @__PURE__ */ React.createElement("div", { className: "info-cell" }, /* @__PURE__ */ React.createElement("div", { className: "k" }, "Prepared By"), /* @__PURE__ */ React.createElement("div", { className: "v" }, docInfo.rep))), /* @__PURE__ */ React.createElement("div", { className: "spec-row" }, /* @__PURE__ */ React.createElement("div", { className: "spec-stat" }, /* @__PURE__ */ React.createElement("div", { className: "n" }, ftInTight(building.width), /* @__PURE__ */ React.createElement("span", { className: "u" }, " W")), /* @__PURE__ */ React.createElement("div", { className: "l" }, "Width")), /* @__PURE__ */ React.createElement("div", { className: "spec-stat" }, /* @__PURE__ */ React.createElement("div", { className: "n" }, ftInTight(building.length), /* @__PURE__ */ React.createElement("span", { className: "u" }, " L")), /* @__PURE__ */ React.createElement("div", { className: "l" }, "Length")), /* @__PURE__ */ React.createElement("div", { className: "spec-stat" }, /* @__PURE__ */ React.createElement("div", { className: "n" }, ftInTight(building.height)), /* @__PURE__ */ React.createElement("div", { className: "l" }, "Eave")), /* @__PURE__ */ React.createElement("div", { className: "spec-stat" }, /* @__PURE__ */ React.createElement("div", { className: "n" }, building.wind, /* @__PURE__ */ React.createElement("span", { className: "u" }, " MPH")), /* @__PURE__ */ React.createElement("div", { className: "l" }, "Wind")), /* @__PURE__ */ React.createElement("div", { className: "spec-stat" }, /* @__PURE__ */ React.createElement("div", { className: "n" }, building.pitch), /* @__PURE__ */ React.createElement("div", { className: "l" }, "Pitch")), /* @__PURE__ */ React.createElement("div", { className: "spec-stat" }, /* @__PURE__ */ React.createElement("div", { className: "n" }, building.trussOC, "\u2032", /* @__PURE__ */ React.createElement("span", { className: "u" }, " OC")), /* @__PURE__ */ React.createElement("div", { className: "l" }, "Trusses")), /* @__PURE__ */ React.createElement("div", { className: "spec-stat" }, /* @__PURE__ */ React.createElement("div", { className: "n" }, GAUGES[building.gauge].label), /* @__PURE__ */ React.createElement("div", { className: "l" }, "Framing")), /* @__PURE__ */ React.createElement("div", { className: "spec-stat" }, /* @__PURE__ */ React.createElement("div", { className: "n spec-stat-text" }, LEG_TYPES[building.legType].short), /* @__PURE__ */ React.createElement("div", { className: "l" }, "Columns"))), building.config !== "enclosed" && /* @__PURE__ */ React.createElement("div", { className: "frame-strip" }, /* @__PURE__ */ React.createElement("div", { className: "fs-cell" }, /* @__PURE__ */ React.createElement("span", { className: "fs-k" }, "Config"), /* @__PURE__ */ React.createElement("span", { className: "fs-v" }, CONFIG_LABEL[building.config], building.config === "hybrid" && /* @__PURE__ */ React.createElement("span", { className: "fs-sub" }, " \xB7 ", ftInTight(Math.max(0, building.length - building.openLength)), " enclosed / ", ftInTight(building.openLength), " ", building.openEnd, building.gableSheet === "gable" ? " \xB7 gable sheeted" : "")))), (() => {
    const fin = docInfo.finishes;
    if (!fin) return null;
    const slots = [
      { key: "roof", label: "Roof" },
      { key: "walls", label: "Walls" },
      { key: "trim", label: "Trim" }
    ];
    if (fin.hasWainscot) slots.push({ key: "wainscot", label: "Wainscot" });
    return /* @__PURE__ */ React.createElement("div", { className: "finish-strip" }, /* @__PURE__ */ React.createElement("div", { className: "finish-strip-k" }, "Finishes"), slots.map((s) => {
      const v = fin[s.key];
      const named = catalogFor(docInfo.mfr || DEFAULT_MFR).colors[v];
      const sw = named ? colorSwatch(docInfo.mfr || DEFAULT_MFR, v) : v && v[0] === "#" ? v : "#888";
      const nm = named ? named.name : v && v[0] === "#" ? v.toUpperCase() : "\u2014";
      const cd = named ? named.code || "" : "";
      return /* @__PURE__ */ React.createElement("div", { key: s.key, className: "finish-strip-cell" }, /* @__PURE__ */ React.createElement("span", { className: "fsc-sw", style: { background: sw } }), /* @__PURE__ */ React.createElement("span", { className: "fsc-text" }, /* @__PURE__ */ React.createElement("span", { className: "fsc-k" }, s.label), /* @__PURE__ */ React.createElement("span", { className: "fsc-v" }, nm, cd ? /* @__PURE__ */ React.createElement("span", { className: "fsc-code" }, "\xA0\xB7\xA0", cd) : null)));
    }));
  })(), /* @__PURE__ */ React.createElement("div", { className: "block-title" }, /* @__PURE__ */ React.createElement("h2", null, "Opening Plan"), /* @__PURE__ */ React.createElement("span", { className: "hint" }, onMove ? "\u2194 Drag any opening \xB7 snaps + aligns \xB7 arrow keys to nudge" : "Top view \xB7 all dimensions to opening edge")), /* @__PURE__ */ React.createElement("div", { className: "plan-wrap" }, /* @__PURE__ */ React.createElement(
    PlanDiagram,
    {
      building,
      openings,
      tagMap,
      showDims,
      showFrames,
      blueprint,
      selectedId,
      onSelect,
      onMove,
      placeType,
      onPlace
    }
  )), showElevation && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "block-title" }, /* @__PURE__ */ React.createElement("h2", null, WALLS[elevWall].label, " Elevation"), /* @__PURE__ */ React.createElement("span", { className: "hint" }, "Opening heights \xB7 ", ftInTight(building.height), " eave")), /* @__PURE__ */ React.createElement("div", { className: "elev-wrap" }, /* @__PURE__ */ React.createElement(
    Elevation,
    {
      building,
      openings,
      tagMap,
      wall: elevWall,
      blueprint,
      compact: true
    }
  ))), /* @__PURE__ */ React.createElement("div", { className: "block-title" }, /* @__PURE__ */ React.createElement("h2", null, "Opening Schedule"), /* @__PURE__ */ React.createElement("span", { className: "hint" }, "Tags match plan callouts")), /* @__PURE__ */ React.createElement(Schedule, { building, openings, tagMap }), /* @__PURE__ */ React.createElement("div", { className: "signoff" }, /* @__PURE__ */ React.createElement("div", { className: "ack" }, /* @__PURE__ */ React.createElement("strong", null, "Customer approval."), " I have reviewed the openings shown above \u2014 type, size, wall, and position \u2014 and confirm they are correct. ", /* @__PURE__ */ React.createElement("strong", null, "Fabrication begins on this layout"), "."), /* @__PURE__ */ React.createElement("div", { className: "sign-lines" }, /* @__PURE__ */ React.createElement("div", { className: "sign-line" }, /* @__PURE__ */ React.createElement("div", { className: "ln" }), /* @__PURE__ */ React.createElement("div", { className: "cap" }, "Customer signature")), /* @__PURE__ */ React.createElement("div", { className: "sign-line" }, /* @__PURE__ */ React.createElement("div", { className: "ln" }), /* @__PURE__ */ React.createElement("div", { className: "cap" }, "Date")))));
}
window.Sheet = Sheet;
