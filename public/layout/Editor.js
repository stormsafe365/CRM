function DimField({ label, value, onChange, unit = "ft", step = 1, min = 0 }) {
  return /* @__PURE__ */ React.createElement("div", { className: "field" }, /* @__PURE__ */ React.createElement("label", null, label), /* @__PURE__ */ React.createElement("div", { className: "dim-input" }, /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "number",
      value,
      step,
      min,
      onChange: (e) => onChange(e.target.value === "" ? "" : parseFloat(e.target.value))
    }
  ), /* @__PURE__ */ React.createElement("span", { className: "unit" }, unit)));
}
function DimTextField({ label, value, onChange }) {
  const [draft, setDraft] = React.useState(null);
  const text = draft != null ? draft : ftInTight(value);
  const parsed = draft != null ? parseFeet(draft) : value;
  const bad = draft != null && draft.trim() !== "" && parsed == null;
  function commit() {
    if (draft == null) return;
    const v = parseFeet(draft);
    if (v != null && v > 0) onChange(Math.round(v * 1e3) / 1e3);
    setDraft(null);
  }
  return /* @__PURE__ */ React.createElement("div", { className: "field" }, /* @__PURE__ */ React.createElement("label", null, label), /* @__PURE__ */ React.createElement("div", { className: "dim-input dim-text" + (bad ? " bad" : "") }, /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "text",
      inputMode: "text",
      value: text,
      onChange: (e) => setDraft(e.target.value),
      onFocus: (e) => {
        setDraft(ftInTight(value));
        requestAnimationFrame(() => e.target.select());
      },
      onBlur: commit,
      onKeyDown: (e) => {
        if (e.key === "Enter") {
          commit();
          e.target.blur();
        }
        if (e.key === "Escape") {
          setDraft(null);
          e.target.blur();
        }
      }
    }
  )), /* @__PURE__ */ React.createElement("div", { className: "dim-hint" }, bad ? `Try 8'11", 23", or 8.5` : draft != null && parsed != null ? ftIn(parsed) : "ft \xB7 in \xB7 8\u203211\u2033"));
}
function FinishPicker({ label, value, mfr, onChange }) {
  const [open, setOpen] = React.useState(false);
  const [customHex, setCustomHex] = React.useState("");
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!open) return;
    function onDoc(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  const cat = catalogFor(mfr);
  const namedEntry = cat.colors[value];
  const isNamed = !!namedEntry;
  const swatchVal = isNamed ? colorSwatch(mfr, value) : value && value[0] === "#" ? value : "#888";
  const labelText = isNamed ? colorLabel(mfr, value) : value && value[0] === "#" ? "Custom " + value.toUpperCase() : "Pick color";
  const codeText = isNamed ? colorCode(mfr, value) : "";
  function commitCustom() {
    const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(customHex.trim());
    if (!m) return;
    onChange("#" + m[1].toUpperCase());
    setCustomHex("");
    setOpen(false);
  }
  return /* @__PURE__ */ React.createElement("div", { className: "finish-row", ref }, /* @__PURE__ */ React.createElement("div", { className: "finish-key" }, label), /* @__PURE__ */ React.createElement("button", { className: "finish-btn" + (open ? " open" : ""), onClick: () => setOpen((o) => !o) }, /* @__PURE__ */ React.createElement("span", { className: "finish-swatch", style: { background: swatchVal } }), /* @__PURE__ */ React.createElement("span", { className: "finish-name-wrap" }, /* @__PURE__ */ React.createElement("span", { className: "finish-name" }, labelText), codeText && /* @__PURE__ */ React.createElement("span", { className: "finish-code" }, codeText)), /* @__PURE__ */ React.createElement("svg", { className: "finish-caret", width: "12", height: "12", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2.2" }, /* @__PURE__ */ React.createElement("path", { d: "M6 9l6 6 6-6" }))), open && /* @__PURE__ */ React.createElement("div", { className: "finish-pop" }, /* @__PURE__ */ React.createElement("div", { className: "finish-grid" }, cat.order.map((k) => {
    const c = cat.colors[k];
    return /* @__PURE__ */ React.createElement(
      "button",
      {
        key: k,
        className: "finish-sw" + (value === k ? " on" : ""),
        title: c.name + (c.code ? " \xB7 " + c.code : ""),
        onClick: () => {
          onChange(k);
          setOpen(false);
        }
      },
      /* @__PURE__ */ React.createElement("span", { className: "finish-sw-chip", style: { background: colorSwatch(mfr, k) } }),
      /* @__PURE__ */ React.createElement("span", { className: "finish-sw-text" }, /* @__PURE__ */ React.createElement("span", { className: "finish-sw-name" }, c.name), c.code && /* @__PURE__ */ React.createElement("span", { className: "finish-sw-code" }, c.code))
    );
  })), /* @__PURE__ */ React.createElement("div", { className: "finish-custom" }, /* @__PURE__ */ React.createElement("span", { className: "finish-custom-lbl" }, "Custom hex"), /* @__PURE__ */ React.createElement(
    "input",
    {
      value: customHex,
      placeholder: "#1A2B3C",
      onChange: (e) => setCustomHex(e.target.value),
      onKeyDown: (e) => {
        if (e.key === "Enter") commitCustom();
      }
    }
  ), /* @__PURE__ */ React.createElement("button", { className: "finish-custom-add", onClick: commitCustom }, "Use"))));
}
function TypeSwatch({ t }) {
  return /* @__PURE__ */ React.createElement("span", { className: "swatch", style: { background: t.color } });
}
function StructSeg({ options, value, onChange }) {
  return /* @__PURE__ */ React.createElement("div", { className: "struct-seg" }, options.map((o) => /* @__PURE__ */ React.createElement(
    "button",
    {
      key: o.value,
      className: "struct-opt" + (o.value === value ? " on" : ""),
      onClick: () => onChange(o.value)
    },
    /* @__PURE__ */ React.createElement("span", { className: "so-main" }, o.main),
    o.sub && /* @__PURE__ */ React.createElement("span", { className: "so-sub" }, o.sub)
  )));
}
function Editor({
  building,
  t,
  setTweak,
  changeConfig,
  docInfo,
  setDocInfo,
  openings,
  setOpenings,
  selectedId,
  setSelectedId,
  placeType,
  setPlaceType,
  savedLayouts,
  onSaveLayout,
  onLoadLayout,
  onDeleteLayout
}) {
  const [removing, setRemoving] = React.useState({});
  const [savingName, setSavingName] = React.useState(false);
  const [nameDraft, setNameDraft] = React.useState("");
  const [flashIds, setFlashIds] = React.useState({});
  const [quickOpen, setQuickOpen] = React.useState(false);
  const [quickWall, setQuickWall] = React.useState("front");
  const [quickOffset, setQuickOffset] = React.useState("");
  function flash(id) {
    setFlashIds((m) => ({ ...m, [id]: true }));
    setTimeout(() => setFlashIds((m) => {
      const n = { ...m };
      delete n[id];
      return n;
    }), 1100);
  }
  React.useEffect(() => {
    const onAdd = (e) => {
      if (e.detail && e.detail.id) flash(e.detail.id);
    };
    window.addEventListener("opening-added", onAdd);
    return () => window.removeEventListener("opening-added", onAdd);
  }, []);
  React.useEffect(() => {
    const valid = visibleWalls(building);
    if (!valid.includes(quickWall)) setQuickWall(valid[0]);
  }, [building.config, building.openEnd]);
  function update(id, patch) {
    setOpenings((prev) => prev.map((o) => o.id === id ? { ...o, ...patch } : o));
  }
  function remove(id) {
    setRemoving((r) => ({ ...r, [id]: true }));
    if (selectedId === id) setSelectedId(null);
    setTimeout(() => {
      setOpenings((prev) => prev.filter((o) => o.id !== id));
      setRemoving((r) => {
        const n = { ...r };
        delete n[id];
        return n;
      });
    }, 200);
  }
  function toggleType(k) {
    setPlaceType(placeType === k ? null : k);
    setSelectedId(null);
  }
  function commitSave() {
    const name = nameDraft.trim();
    if (!name) {
      setSavingName(false);
      return;
    }
    onSaveLayout(name);
    setNameDraft("");
    setSavingName(false);
  }
  const tagMap = window.__tagMap || {};
  return /* @__PURE__ */ React.createElement("aside", { className: "rail" }, /* @__PURE__ */ React.createElement("h3", { className: "rail-title" }, "Layout Builder"), /* @__PURE__ */ React.createElement("div", { className: "rail-sub" }, "Place openings, then switch to Approval Sheet to review & export."), /* @__PURE__ */ React.createElement("div", { className: "section-label" }, "Building"), /* @__PURE__ */ React.createElement("div", { className: "grid-3" }, /* @__PURE__ */ React.createElement(DimField, { label: "Width", value: t.width, onChange: (v) => setTweak("width", v) }), /* @__PURE__ */ React.createElement(DimField, { label: "Length", value: t.length, onChange: (v) => setTweak("length", v) }), /* @__PURE__ */ React.createElement(DimField, { label: "Eave", value: t.height, onChange: (v) => setTweak("height", v) })), /* @__PURE__ */ React.createElement("div", { className: "grid-2" }, /* @__PURE__ */ React.createElement(DimField, { label: "Wind rating", value: t.wind, unit: "mph", step: 5, onChange: (v) => setTweak("wind", v) }), /* @__PURE__ */ React.createElement("div", { className: "field" }, /* @__PURE__ */ React.createElement("label", null, "Roof pitch"), /* @__PURE__ */ React.createElement("input", { value: t.pitch, onChange: (e) => setTweak("pitch", e.target.value) }))), /* @__PURE__ */ React.createElement("div", { className: "section-label" }, "Finishes & Color"), (() => {
    const fin = docInfo.finishes || DEFAULT_FINISHES;
    const mfr = docInfo.mfr || DEFAULT_MFR;
    function setFin(patch) {
      setDocInfo({ ...docInfo, finishes: { ...fin, ...patch } });
    }
    function setMfr(next) {
      if (next === mfr) return;
      const migrated = migrateFinishes(fin, mfr, next);
      setDocInfo({ ...docInfo, mfr: next, finishes: migrated });
    }
    const slots = [
      { key: "roof", label: "Roof" },
      { key: "walls", label: "Walls" },
      { key: "trim", label: "Trim" }
    ];
    if (fin.hasWainscot) slots.push({ key: "wainscot", label: "Wainscot" });
    return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "mfr-row", title: "Internal only \u2014 does not appear on the client approval sheet" }, /* @__PURE__ */ React.createElement("span", { className: "mfr-k" }, "Catalog", /* @__PURE__ */ React.createElement("span", { className: "mfr-private", "aria-label": "Internal only" }, /* @__PURE__ */ React.createElement("svg", { width: "10", height: "10", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2.4" }, /* @__PURE__ */ React.createElement("rect", { x: "4", y: "11", width: "16", height: "10", rx: "2" }), /* @__PURE__ */ React.createElement("path", { d: "M8 11V7a4 4 0 0 1 8 0v4" })), "Internal")), /* @__PURE__ */ React.createElement("div", { className: "mfr-seg" }, MFR_ORDER.map((k) => /* @__PURE__ */ React.createElement("button", { key: k, className: "mfr-opt" + (mfr === k ? " on" : ""), onClick: () => setMfr(k) }, COLOR_CATALOGS[k].label)))), /* @__PURE__ */ React.createElement("div", { className: "finish-list" }, slots.map((s) => /* @__PURE__ */ React.createElement(FinishPicker, { key: s.key, label: s.label, value: fin[s.key], mfr, onChange: (v) => setFin({ [s.key]: v }) }))), /* @__PURE__ */ React.createElement(
      "button",
      {
        className: "wainscot-toggle" + (fin.hasWainscot ? " on" : ""),
        onClick: () => setFin({ hasWainscot: !fin.hasWainscot })
      },
      /* @__PURE__ */ React.createElement("span", { className: "ws-dot" }),
      /* @__PURE__ */ React.createElement("span", null, fin.hasWainscot ? "Wainscot enabled" : "Add wainscot"),
      fin.hasWainscot && /* @__PURE__ */ React.createElement("span", { className: "ws-remove" }, "Remove")
    ));
  })(), /* @__PURE__ */ React.createElement("div", { className: "section-label" }, "Configuration"), /* @__PURE__ */ React.createElement(
    StructSeg,
    {
      value: building.config,
      onChange: (v) => changeConfig({ config: v }),
      options: [
        { value: "enclosed", main: "Enclosed", sub: "Fully sheeted" },
        { value: "hybrid", main: "Hybrid", sub: "Garage + Carport" },
        { value: "carport", main: "Carport", sub: "Open structure" }
      ]
    }
  ), building.config === "hybrid" && /* @__PURE__ */ React.createElement("div", { style: { marginTop: "var(--space-3)" } }, /* @__PURE__ */ React.createElement("div", { className: "struct-field" }, /* @__PURE__ */ React.createElement("div", { className: "struct-head" }, /* @__PURE__ */ React.createElement("label", null, "Open carport end"), /* @__PURE__ */ React.createElement("span", { className: "struct-note" }, building.openEnd === "front" ? "Open extends forward" : "Open extends rearward")), /* @__PURE__ */ React.createElement(
    StructSeg,
    {
      value: building.openEnd,
      onChange: (v) => changeConfig({ openEnd: v }),
      options: [
        { value: "front", main: "Front", sub: "Front gable open" },
        { value: "back", main: "Back", sub: "Back gable open" }
      ]
    }
  )), /* @__PURE__ */ React.createElement("div", { className: "struct-field" }, /* @__PURE__ */ React.createElement("div", { className: "struct-head" }, /* @__PURE__ */ React.createElement("label", null, "Open-end sheeting"), /* @__PURE__ */ React.createElement("span", { className: "struct-note" }, building.gableSheet === "gable" ? "Peak triangle is sheeted" : "Fully open at the eave")), /* @__PURE__ */ React.createElement(
    StructSeg,
    {
      value: building.gableSheet,
      onChange: (v) => setTweak("gableSheet", v),
      options: [
        { value: "open", main: "Open", sub: "No gable sheeting" },
        { value: "gable", main: "Gable Only", sub: "Peak sheeted" }
      ]
    }
  )), /* @__PURE__ */ React.createElement("div", { className: "grid-2" }, /* @__PURE__ */ React.createElement(
    DimField,
    {
      label: "Enclosed",
      value: Math.max(0, building.length - building.openLength),
      step: 1,
      onChange: (v) => {
        const enc = Math.max(0, Math.min(building.length, Number(v) || 0));
        setTweak("openLength", Math.max(0, Math.min(building.length, building.length - enc)));
      }
    }
  ), /* @__PURE__ */ React.createElement(
    DimField,
    {
      label: "Carport",
      value: building.openLength,
      step: 1,
      onChange: (v) => setTweak("openLength", Math.max(0, Math.min(building.length, Number(v) || 0)))
    }
  )), /* @__PURE__ */ React.createElement("div", { className: "helper", style: { marginTop: "2px" } }, "Additional End Wall sits ", ftInTight(building.openEnd === "back" ? building.openLength : building.length - building.openLength), " from the back \xB7 carport extends ", ftInTight(building.openLength), " from the ", building.openEnd, ".")), building.config === "carport" && /* @__PURE__ */ React.createElement("div", { className: "helper", style: { marginTop: "var(--space-2)" } }, "Open structure \u2014 roof + frame only, no sheeted walls. Place frame-outs to mark structural posts."), (() => {
    const tOpts = trussOptions(building.width);
    const baseOC = baseTrussOC(building.width);
    const legOpts = legOptions(building.width, building.height);
    const baseLeg = baseLegType(building.width, building.height);
    const legForced = legOpts.length === 1;
    const legReason = building.width >= 32 ? `${ftInTight(building.width)} wide \u2192 ladder legs required` : `${ftInTight(building.height)} eave \u2192 ${LEG_TYPES[baseLeg].label.toLowerCase()} minimum`;
    return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "section-label" }, "Framing & Structure"), /* @__PURE__ */ React.createElement("div", { className: "struct-field" }, /* @__PURE__ */ React.createElement("div", { className: "struct-head" }, /* @__PURE__ */ React.createElement("label", null, "Truss spacing"), /* @__PURE__ */ React.createElement("span", { className: "struct-note" }, baseOC, "\u2032 standard for ", ftInTight(building.width), " wide")), /* @__PURE__ */ React.createElement(
      StructSeg,
      {
        value: building.trussOC,
        onChange: (v) => setTweak("trussOC", v),
        options: tOpts.map((oc) => ({ value: oc, main: oc + "\u2032 OC", sub: oc === baseOC ? "Standard" : "Upgrade" }))
      }
    ), /* @__PURE__ */ React.createElement("div", { className: "struct-helper" }, frameCount(building.length, building.trussOC), " frames across ", ftInTight(building.length), " \xB7 trusses on the eave (length) sides.")), /* @__PURE__ */ React.createElement("div", { className: "struct-field" }, /* @__PURE__ */ React.createElement("div", { className: "struct-head" }, /* @__PURE__ */ React.createElement("label", null, "Framing gauge"), /* @__PURE__ */ React.createElement("span", { className: "struct-note" }, GAUGES[building.gauge].tube, " tube")), /* @__PURE__ */ React.createElement(
      StructSeg,
      {
        value: building.gauge,
        onChange: (v) => setTweak("gauge", v),
        options: GAUGE_ORDER.map((g) => ({ value: g, main: GAUGES[g].label, sub: GAUGES[g].tube }))
      }
    )), /* @__PURE__ */ React.createElement("div", { className: "struct-field" }, /* @__PURE__ */ React.createElement("div", { className: "struct-head" }, /* @__PURE__ */ React.createElement("label", null, "Column / leg type"), legForced && /* @__PURE__ */ React.createElement("span", { className: "struct-note struct-lock" }, "Auto")), /* @__PURE__ */ React.createElement(
      StructSeg,
      {
        value: building.legType,
        onChange: (v) => setTweak("legType", v),
        options: legOpts.map((k) => ({ value: k, main: LEG_TYPES[k].short, sub: LEG_TYPES[k].range }))
      }
    ), /* @__PURE__ */ React.createElement("div", { className: "struct-helper" }, LEG_TYPES[building.legType].desc, ". ", legForced ? legReason + "." : "Upgrade available.")));
  })(), /* @__PURE__ */ React.createElement("div", { className: "section-label" }, "Document Info"), /* @__PURE__ */ React.createElement("div", { className: "field" }, /* @__PURE__ */ React.createElement("label", null, "Customer"), /* @__PURE__ */ React.createElement("input", { value: docInfo.customer, onChange: (e) => setDocInfo({ ...docInfo, customer: e.target.value }) })), /* @__PURE__ */ React.createElement("div", { className: "field" }, /* @__PURE__ */ React.createElement("label", null, "Building site address"), /* @__PURE__ */ React.createElement("textarea", { value: docInfo.address, onChange: (e) => setDocInfo({ ...docInfo, address: e.target.value }) })), /* @__PURE__ */ React.createElement("div", { className: "grid-2" }, /* @__PURE__ */ React.createElement("div", { className: "field" }, /* @__PURE__ */ React.createElement("label", null, "Quote no."), /* @__PURE__ */ React.createElement("input", { value: docInfo.quoteNo, onChange: (e) => setDocInfo({ ...docInfo, quoteNo: e.target.value }) })), /* @__PURE__ */ React.createElement("div", { className: "field" }, /* @__PURE__ */ React.createElement("label", null, "Rep"), /* @__PURE__ */ React.createElement("input", { value: docInfo.rep, onChange: (e) => setDocInfo({ ...docInfo, rep: e.target.value }) }))), /* @__PURE__ */ React.createElement("div", { className: "section-label" }, "Add Opening"), /* @__PURE__ */ React.createElement("div", { className: "place-hint" + (placeType ? " on" : "") }, placeType ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("b", null, "Placing ", OPENING_TYPES[placeType].label, "."), " Click any wall on the plan to drop one. Keep clicking to add more. ", /* @__PURE__ */ React.createElement("b", null, "Esc"), " to stop.") : /* @__PURE__ */ React.createElement(React.Fragment, null, "Pick a type, then click any wall on the plan. Or use ", /* @__PURE__ */ React.createElement("b", null, "Quick Add"), " below for an exact position.")), /* @__PURE__ */ React.createElement("div", { className: "type-grid" }, TYPE_ORDER.map((k) => {
    const ot = OPENING_TYPES[k];
    return /* @__PURE__ */ React.createElement(
      "button",
      {
        key: k,
        className: "type-card" + (placeType === k ? " arming" : ""),
        onClick: () => toggleType(k)
      },
      /* @__PURE__ */ React.createElement(TypeSwatch, { t: ot }),
      /* @__PURE__ */ React.createElement("span", null, ot.label)
    );
  })), /* @__PURE__ */ React.createElement(
    "button",
    {
      className: "quick-add-toggle" + (quickOpen ? " on" : ""),
      onClick: () => setQuickOpen((q) => !q)
    },
    /* @__PURE__ */ React.createElement("svg", { width: "13", height: "13", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2.4" }, /* @__PURE__ */ React.createElement("path", { d: "M12 5v14M5 12h14" })),
    "Quick Add",
    /* @__PURE__ */ React.createElement("svg", { className: "qa-caret" + (quickOpen ? " open" : ""), width: "13", height: "13", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2.2" }, /* @__PURE__ */ React.createElement("path", { d: "M6 9l6 6 6-6" }))
  ), quickOpen && (() => {
    const armed = placeType || "rollup";
    const def = OPENING_TYPES[armed];
    const wl = wallLength(quickWall, building);
    const offNum = Math.max(0, Math.min(wl - def.w, Number(quickOffset) || 0));
    const refLbl = quickWall === "left" || quickWall === "right" ? "BACK" : "LEFT";
    const farLbl = quickWall === "left" || quickWall === "right" ? "FRONT" : "RIGHT";
    const farDist = Math.max(0, wl - offNum - def.w);
    function commit() {
      if (!quickOffset && quickOffset !== 0) {
        setQuickOffset("0");
        return;
      }
      const op = makeOpening(armed, quickWall, offNum);
      setOpenings((prev) => [...prev, op]);
      setSelectedId(op.id);
      flash(op.id);
      setQuickOffset("");
    }
    return /* @__PURE__ */ React.createElement("div", { className: "quick-add" }, /* @__PURE__ */ React.createElement("div", { className: "qa-row" }, /* @__PURE__ */ React.createElement("div", { className: "qa-field" }, /* @__PURE__ */ React.createElement("label", null, "Type"), /* @__PURE__ */ React.createElement("select", { value: armed, onChange: (e) => setPlaceType(e.target.value) }, TYPE_ORDER.map((k) => /* @__PURE__ */ React.createElement("option", { key: k, value: k }, OPENING_TYPES[k].label)))), /* @__PURE__ */ React.createElement("div", { className: "qa-field" }, /* @__PURE__ */ React.createElement("label", null, "Wall"), /* @__PURE__ */ React.createElement("select", { value: quickWall, onChange: (e) => setQuickWall(e.target.value) }, visibleWalls(building).map((w) => /* @__PURE__ */ React.createElement("option", { key: w, value: w }, w === "divider" ? "Additional End Wall" : WALLS[w].label))))), /* @__PURE__ */ React.createElement("div", { className: "qa-row" }, /* @__PURE__ */ React.createElement("div", { className: "qa-field qa-offset" }, /* @__PURE__ */ React.createElement("label", null, "From ", refLbl, " corner"), /* @__PURE__ */ React.createElement("div", { className: "dim-input" }, /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "number",
        step: "0.5",
        min: "0",
        max: Math.max(0, wl - def.w),
        placeholder: "0",
        value: quickOffset,
        onChange: (e) => setQuickOffset(e.target.value),
        onKeyDown: (e) => {
          if (e.key === "Enter") commit();
        }
      }
    ), /* @__PURE__ */ React.createElement("span", { className: "unit" }, "ft"))), /* @__PURE__ */ React.createElement("button", { className: "qa-add", onClick: commit }, /* @__PURE__ */ React.createElement("svg", { width: "15", height: "15", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2.5" }, /* @__PURE__ */ React.createElement("path", { d: "M12 5v14M5 12h14" })), "Add")), /* @__PURE__ */ React.createElement("div", { className: "qa-preview" }, def.w, "\u2032 \xD7 ", def.h, "\u2032 \xB7 ", /* @__PURE__ */ React.createElement("b", null, ftInTight(offNum)), " from ", refLbl.toLowerCase(), " \xB7 ", /* @__PURE__ */ React.createElement("b", null, ftInTight(farDist)), " to ", farLbl.toLowerCase(), " \xB7 wall is ", ftInTight(wl)));
  })(), /* @__PURE__ */ React.createElement("div", { className: "section-label" }, "Placed \xB7 ", openings.length), openings.length === 0 && /* @__PURE__ */ React.createElement("div", { className: "empty-note" }, "No openings yet. Pick a type above and click the plan to start."), /* @__PURE__ */ React.createElement("div", { className: "op-list" }, openings.map((op) => {
    const ot = OPENING_TYPES[op.type];
    const isOpen = selectedId === op.id;
    const wl = wallLength(op.wall, building);
    return /* @__PURE__ */ React.createElement("div", { key: op.id, className: "op-row" + (isOpen ? " open sel" : "") + (removing[op.id] ? " removing" : "") + (flashIds[op.id] ? " just-added" : "") }, /* @__PURE__ */ React.createElement("div", { className: "op-row-head", onClick: () => setSelectedId(isOpen ? null : op.id) }, /* @__PURE__ */ React.createElement("span", { className: "op-tag", style: { background: ot.color } }, tagMap[op.id] || "\u2022"), /* @__PURE__ */ React.createElement("span", { className: "op-name" }, op.name && op.name.trim() ? op.name.trim() : ot.label), /* @__PURE__ */ React.createElement("span", { className: "op-meta-wall" }, op.wall === "divider" ? "Add. End Wall" : WALLS[op.wall].label), /* @__PURE__ */ React.createElement("span", { className: "op-size" }, sizeLabel(op)), /* @__PURE__ */ React.createElement("svg", { className: "caret", width: "14", height: "14", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2.5" }, /* @__PURE__ */ React.createElement("path", { d: "M9 6l6 6-6 6" }))), isOpen && /* @__PURE__ */ React.createElement("div", { className: "op-body" }, /* @__PURE__ */ React.createElement("div", { className: "grid-2" }, /* @__PURE__ */ React.createElement("div", { className: "field" }, /* @__PURE__ */ React.createElement("label", null, "Type"), /* @__PURE__ */ React.createElement("select", { value: op.type, onChange: (e) => {
      const nt = OPENING_TYPES[e.target.value];
      update(op.id, { type: e.target.value, w: nt.w, h: nt.h });
    } }, TYPE_ORDER.map((k) => /* @__PURE__ */ React.createElement("option", { key: k, value: k }, OPENING_TYPES[k].label)))), /* @__PURE__ */ React.createElement("div", { className: "field" }, /* @__PURE__ */ React.createElement("label", null, "Wall"), /* @__PURE__ */ React.createElement("select", { value: op.wall, onChange: (e) => update(op.id, { wall: e.target.value }) }, visibleWalls(building).map((w) => /* @__PURE__ */ React.createElement("option", { key: w, value: w }, w === "divider" ? "Additional End Wall" : WALLS[w].label))))), /* @__PURE__ */ React.createElement("div", { className: "grid-2" }, /* @__PURE__ */ React.createElement(DimTextField, { label: "Width", value: op.w, onChange: (v) => update(op.id, { w: v }) }), /* @__PURE__ */ React.createElement(DimTextField, { label: "Height", value: op.h, onChange: (v) => update(op.id, { h: v }) })), (() => {
      const isEave = op.wall === "left" || op.wall === "right";
      const nearRef = isEave ? "Back" : "Left";
      const farRef = isEave ? "Front" : "Right";
      const farDist = Math.max(0, wl - op.offset - op.w);
      return /* @__PURE__ */ React.createElement("div", { className: "grid-2" }, /* @__PURE__ */ React.createElement(
        DimField,
        {
          label: `From ${nearRef}`,
          value: op.offset,
          step: 0.5,
          onChange: (v) => update(op.id, { offset: Math.max(0, Math.min(wl - op.w, Number(v) || 0)) })
        }
      ), /* @__PURE__ */ React.createElement(
        DimField,
        {
          label: `From ${farRef}`,
          value: Number(farDist.toFixed(3)),
          step: 0.5,
          onChange: (v) => {
            const f = Math.max(0, Math.min(wl - op.w, Number(v) || 0));
            update(op.id, { offset: Math.max(0, wl - op.w - f) });
          }
        }
      ));
    })(), (() => {
      const sibs = openings.filter((o) => o.wall === op.wall && o.id !== op.id).slice().sort((a, b) => a.offset - b.offset);
      const prev = sibs.filter((o) => o.offset + o.w <= op.offset + 1e-3).slice(-1)[0];
      const next = sibs.find((o) => o.offset >= op.offset + op.w - 1e-3);
      const prevGap = prev ? op.offset - (prev.offset + prev.w) : null;
      const nextGap = next ? next.offset - (op.offset + op.w) : null;
      const farDist2 = Math.max(0, wl - op.offset - op.w);
      const overflow = op.offset + op.w > wl + 0.01;
      return /* @__PURE__ */ React.createElement("div", { className: "spacing-helper" }, overflow ? /* @__PURE__ */ React.createElement("span", { className: "sp-warn" }, "\u26A0 Extends past corner \u2014 reduce position or width.") : /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("span", { className: "sp-row" }, /* @__PURE__ */ React.createElement("b", null, ftInTight(op.offset)), " from ", op.wall === "left" || op.wall === "right" ? "back" : "left", " \xB7 ", /* @__PURE__ */ React.createElement("b", null, ftInTight(farDist2)), " from ", op.wall === "left" || op.wall === "right" ? "front" : "right", " \xB7 wall ", ftInTight(wl)), (prev || next) && /* @__PURE__ */ React.createElement("span", { className: "sp-row sp-row-2" }, prev && /* @__PURE__ */ React.createElement(React.Fragment, null, "\u2190 ", /* @__PURE__ */ React.createElement("b", null, ftInTight(prevGap)), " to ", tagMap[prev.id] != null ? `\xB7${tagMap[prev.id]}` : "prev"), prev && next && /* @__PURE__ */ React.createElement("span", { className: "sp-sep" }, "\xB7"), next && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("b", null, ftInTight(nextGap)), " to ", tagMap[next.id] != null ? `\xB7${tagMap[next.id]}` : "next", " \u2192"))));
    })(), op.type === "window" && /* @__PURE__ */ React.createElement(DimTextField, { label: "Sill height (off floor)", value: op.sill, onChange: (v) => update(op.id, { sill: v }) }), (op.type === "custom" || op.type === "framed") && /* @__PURE__ */ React.createElement("div", { className: "field" }, /* @__PURE__ */ React.createElement("label", null, "Product / label"), /* @__PURE__ */ React.createElement(
      "input",
      {
        value: op.name,
        placeholder: op.type === "custom" ? "e.g. Equipment bay" : "Optional label",
        onChange: (e) => update(op.id, { name: e.target.value })
      }
    )), /* @__PURE__ */ React.createElement("div", { className: "field" }, /* @__PURE__ */ React.createElement("label", null, "Note"), /* @__PURE__ */ React.createElement("input", { value: op.note, placeholder: "Optional \u2014 e.g. on right side of wall", onChange: (e) => update(op.id, { note: e.target.value }) })), /* @__PURE__ */ React.createElement("div", { className: "op-actions" }, /* @__PURE__ */ React.createElement("button", { className: "mini-btn", onClick: () => {
      const dup = makeOpening(op.type, op.wall, Math.min(op.offset + 2, Math.max(0, wl - op.w)), { w: op.w, h: op.h, sill: op.sill, name: op.name, note: op.note });
      setOpenings((prev) => [...prev, dup]);
      setSelectedId(dup.id);
      flash(dup.id);
    } }, "Duplicate"), /* @__PURE__ */ React.createElement("button", { className: "op-del", onClick: () => remove(op.id) }, "Remove"))));
  })), /* @__PURE__ */ React.createElement("div", { className: "section-label" }, "Saved Layouts"), savingName ? /* @__PURE__ */ React.createElement("div", { className: "save-row" }, /* @__PURE__ */ React.createElement(
    "input",
    {
      autoFocus: true,
      value: nameDraft,
      placeholder: "Name this layout\u2026",
      onChange: (e) => setNameDraft(e.target.value),
      onKeyDown: (e) => {
        if (e.key === "Enter") commitSave();
        if (e.key === "Escape") setSavingName(false);
      }
    }
  ), /* @__PURE__ */ React.createElement("button", { className: "mini-btn primary", onClick: commitSave }, "Save")) : /* @__PURE__ */ React.createElement("button", { className: "save-btn", onClick: () => {
    setNameDraft(docInfo.customer ? docInfo.customer.split("\u2014")[0].trim() : "");
    setSavingName(true);
  } }, /* @__PURE__ */ React.createElement("svg", { width: "15", height: "15", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2" }, /* @__PURE__ */ React.createElement("path", { d: "M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" }), /* @__PURE__ */ React.createElement("path", { d: "M17 21v-8H7v8M7 3v5h8" })), "Save current layout"), savedLayouts.length === 0 && /* @__PURE__ */ React.createElement("div", { className: "empty-note", style: { marginTop: "8px" } }, "No saved layouts yet."), /* @__PURE__ */ React.createElement("div", { className: "saved-list" }, savedLayouts.map((L) => /* @__PURE__ */ React.createElement("div", { key: L.id, className: "saved-row" }, /* @__PURE__ */ React.createElement("button", { className: "saved-load", onClick: () => onLoadLayout(L.id) }, /* @__PURE__ */ React.createElement("span", { className: "sl-name" }, L.name), /* @__PURE__ */ React.createElement("span", { className: "sl-meta" }, ftInTight(L.building.width), "\xD7", ftInTight(L.building.length), " \xB7 ", L.openings.length, " opening", L.openings.length === 1 ? "" : "s")), /* @__PURE__ */ React.createElement("button", { className: "saved-del", title: "Delete", onClick: () => onDeleteLayout(L.id) }, /* @__PURE__ */ React.createElement("svg", { width: "14", height: "14", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2" }, /* @__PURE__ */ React.createElement("path", { d: "M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" })))))), /* @__PURE__ */ React.createElement("div", { style: { height: "40px" } }));
}
window.Editor = Editor;
