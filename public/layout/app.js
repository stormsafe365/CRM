const TWEAK_DEFAULTS = (
  /*EDITMODE-BEGIN*/
  {
    "style": "engineering",
    "accent": "#14A6A0",
    "density": "regular",
    "showDims": true,
    "showFrames": true,
    "showElev": false,
    "elevWall": "front",
    "width": 40,
    "length": 50,
    "height": 16,
    "wind": 150,
    "pitch": "3:12",
    "trussOC": 4,
    "gauge": "14",
    "legType": "ladder",
    "config": "enclosed",
    "openEnd": "front",
    "openLength": 20,
    "gableSheet": "open"
  }
);
function computeTagMap(openings) {
  const order = { front: 0, right: 1, back: 2, left: 3, divider: 4 };
  const sorted = openings.slice().sort((a, b) => {
    if ((order[a.wall] || 0) !== (order[b.wall] || 0)) return (order[a.wall] || 0) - (order[b.wall] || 0);
    return a.offset - b.offset;
  });
  const map = {};
  sorted.forEach((o, i) => {
    map[o.id] = i + 1;
  });
  return map;
}
const WALL_CHIPS = [
  { key: "front", label: "Front" },
  { key: "back", label: "Back" },
  { key: "left", label: "Left" },
  { key: "right", label: "Right" }
];
function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [mode, setMode] = React.useState("edit");
  const restored = React.useRef(loadCurrent());
  const [openings, setOpenings] = React.useState(() => {
    const ops = restored.current && Array.isArray(restored.current.openings) && restored.current.openings.length ? restored.current.openings : defaultOpenings();
    bumpIdsPast(ops);
    return ops;
  });
  const [selectedId, setSelectedId] = React.useState(null);
  const [placeType, setPlaceType] = React.useState(null);
  const [tweaksOpen, setTweaksOpen] = React.useState(false);
  const [savedLayouts, setSavedLayouts] = React.useState(() => {
    const layouts = loadLayouts();
    layouts.forEach((L) => bumpIdsPast(L.openings));
    return layouts;
  });
  const [docInfo, setDocInfo] = React.useState(() => {
    const r = restored.current && restored.current.docInfo;
    const base = r || {
      customer: DEFAULT_BUILDING.customer,
      address: DEFAULT_BUILDING.address,
      quoteNo: DEFAULT_BUILDING.quoteNo,
      rep: DEFAULT_BUILDING.rep,
      date: ""
    };
    return {
      ...base,
      mfr: base.mfr || DEFAULT_MFR,
      finishes: { ...DEFAULT_FINISHES, ...base.finishes || {} }
    };
  });
  const docInfoRef = React.useRef(docInfo);
  docInfoRef.current = docInfo;
  React.useEffect(() => {
    function seedFromCRM(d) {
      if (!d) return;
      if (d.size) {
        const m = String(d.size).match(/(\d+(?:\.\d+)?)\s*[xX×]\s*(\d+(?:\.\d+)?)(?:\s*[xX×]\s*(\d+(?:\.\d+)?))?/);
        if (m) {
          const edits = { width: Number(m[1]), length: Number(m[2]) };
          if (m[3]) edits.height = Number(m[3]);
          setTweak(edits);
        }
      }
      setDocInfo((prev) => ({
        ...prev,
        customer: d.customer || prev.customer,
        address: d.address || prev.address
      }));
    }
    function customerName() {
      return docInfoRef.current && docInfoRef.current.customer || "";
    }
    async function getSheetHtml() {
      setMode("sheet");
      await new Promise((r) => setTimeout(r, 450));
      const el = document.querySelector(".sheet");
      if (!el) return "";
      const base = location.href.replace(/[^/]*$/, "");
      let css = "";
      for (const link of Array.from(document.querySelectorAll('link[rel="stylesheet"]'))) {
        try {
          css += await (await fetch(link.href)).text() + "\n";
        } catch (e) {
        }
      }
      const imports = Array.from(css.matchAll(/@import\s+url\(['"]?([^'")]+)['"]?\)\s*;/g)).map((m) => m[1]);
      for (const rel of imports) {
        try {
          css += await (await fetch(new URL(rel, base).href)).text() + "\n";
        } catch (e) {
        }
      }
      css = css.replace(/@import[^;]+;/g, "");
      css = css.replace(/url\((['"]?)(?!data:|https?:|\/|#)/g, (mm, q) => "url(" + q + base);
      return '<!doctype html><html><head><meta charset="utf-8"><style>' + css + "\nbody{margin:0;background:#fff}</style></head><body>" + el.outerHTML + "</body></html>";
    }
    window.SS_LAYOUT = { seedFromCRM, getSheetHtml, customerName };
    return () => {
      try {
        delete window.SS_LAYOUT;
      } catch (e) {
        window.SS_LAYOUT = void 0;
      }
    };
  }, [setTweak]);
  const building = (() => {
    const width = Number(t.width) || 0;
    const height = Number(t.height) || 0;
    const length = Number(t.length) || 0;
    const config = normalizeConfig({ config: t.config });
    const openEnd = t.openEnd === "back" ? "back" : "front";
    const openLength = config === "hybrid" ? Math.max(0, Math.min(length, Number(t.openLength) || 0)) : config === "carport" ? length : 0;
    return {
      width,
      height,
      length,
      wind: Number(t.wind) || 0,
      pitch: t.pitch || "3:12",
      trussOC: normalizeTrussOC(width, t.trussOC),
      gauge: String(t.gauge || "14"),
      legType: normalizeLegType(width, height, t.legType),
      config,
      openEnd,
      openLength,
      gableSheet: t.gableSheet === "gable" ? "gable" : "open"
    };
  })();
  function changeConfig(patch) {
    const oldB = building;
    const newB = {
      ...oldB,
      ...patch,
      config: patch.config != null ? normalizeConfig({ config: patch.config }) : oldB.config
    };
    if (newB.config === "enclosed") newB.openLength = 0;
    if (newB.config === "carport") newB.openLength = newB.length;
    if (newB.config === "hybrid" && (!newB.openLength || newB.openLength <= 0)) newB.openLength = Math.max(8, Math.round(newB.length / 2));
    const migrated = migrateOpenings(oldB, newB, openings);
    if (migrated !== openings) setOpenings(migrated);
    setTweak({
      config: newB.config,
      openEnd: newB.openEnd,
      openLength: newB.openLength
    });
  }
  const tagMap = computeTagMap(openings);
  window.__tagMap = tagMap;
  React.useEffect(() => {
    persistCurrent({ openings, docInfo });
  }, [openings, docInfo]);
  React.useEffect(() => {
    const onMsg = (e) => {
      const ty = e && e.data && e.data.type;
      if (ty === "__activate_edit_mode") setTweaksOpen(true);
      else if (ty === "__deactivate_edit_mode" || ty === "__edit_mode_dismissed") setTweaksOpen(false);
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);
  function toggleTweaks() {
    const next = !tweaksOpen;
    setTweaksOpen(next);
    window.postMessage({ type: next ? "__activate_edit_mode" : "__deactivate_edit_mode" }, "*");
  }
  function placeOpening(wall, off) {
    if (!placeType) return;
    const op = makeOpening(placeType, wall, off);
    setOpenings((prev) => [...prev, op]);
    setSelectedId(op.id);
    window.dispatchEvent(new CustomEvent("opening-added", { detail: { id: op.id } }));
  }
  React.useEffect(() => {
    function onKey(e) {
      const tag = e.target && e.target.tagName || "";
      const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.target && e.target.isContentEditable;
      if (e.key === "Escape") {
        setPlaceType(null);
        setSelectedId(null);
        return;
      }
      if (typing || mode !== "edit") return;
      if (selectedId == null) return;
      const op = openings.find((o) => o.id === selectedId);
      if (!op) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        setOpenings((prev) => prev.filter((o) => o.id !== selectedId));
        setSelectedId(null);
        return;
      }
      const dirs = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 };
      if (e.key in dirs) {
        e.preventDefault();
        const step = e.metaKey || e.ctrlKey ? 1 : e.shiftKey ? 0.5 : 1 / 12;
        const wl = wallLength(op.wall, building);
        let off = op.offset + dirs[e.key] * step;
        off = Math.round(off * 12) / 12;
        off = Math.max(0, Math.min(wl - op.w, off));
        setOpenings((prev) => prev.map((o) => o.id === selectedId ? { ...o, offset: off } : o));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, openings, mode, building.width, building.length]);
  function saveLayout(name) {
    const rec = {
      id: uniqueId(),
      name,
      savedAt: Date.now(),
      building: { ...building },
      openings: openings.map((o) => ({ ...o })),
      docInfo: { ...docInfo }
    };
    const next = [rec, ...savedLayouts].slice(0, 30);
    setSavedLayouts(next);
    persistLayouts(next);
  }
  function loadLayout(id) {
    const rec = savedLayouts.find((L) => L.id === id);
    if (!rec) return;
    const b = rec.building || {};
    setTweak({
      width: b.width,
      length: b.length,
      height: b.height,
      wind: b.wind,
      pitch: b.pitch,
      trussOC: b.trussOC,
      gauge: b.gauge,
      legType: b.legType,
      config: b.config || "enclosed",
      openEnd: b.openEnd || "front",
      openLength: b.openLength || 0,
      gableSheet: b.gableSheet || "open"
    });
    setOpenings(rec.openings.map((o) => ({ ...o })));
    setDocInfo({ ...rec.docInfo });
    setSelectedId(null);
    setPlaceType(null);
  }
  function deleteLayout(id) {
    const next = savedLayouts.filter((L) => L.id !== id);
    setSavedLayouts(next);
    persistLayouts(next);
  }
  const appStyle = {
    "--ss-accent": t.accent,
    "--ss-accent-hover": "color-mix(in srgb, " + t.accent + " 86%, black)",
    "--ss-accent-press": "color-mix(in srgb, " + t.accent + " 72%, black)",
    "--teal-500": t.accent
  };
  const STYLES = [
    { key: "engineering", label: "Engineering" },
    { key: "stamp", label: "Steel Stamp" },
    { key: "blueprint", label: "Blueprint" }
  ];
  function fitForPrint() {
    const sheet = document.querySelector(".sheet");
    if (!sheet) return;
    sheet.style.zoom = "";
    const PRINT_W = 816 - 2;
    const PRINT_H = 1056 - 2;
    const z = Math.min(PRINT_W / sheet.scrollWidth, PRINT_H / sheet.scrollHeight, 1);
    sheet.style.zoom = z.toFixed(4);
  }
  React.useEffect(() => {
    const before = () => fitForPrint();
    const after = () => {
      const s = document.querySelector(".sheet");
      if (s) s.style.zoom = "";
    };
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  });
  function doPrint() {
    const wasEdit = mode === "edit";
    if (wasEdit) {
      setSelectedId(null);
      setPlaceType(null);
      setMode("sheet");
    }
    setTimeout(() => {
      fitForPrint();
      window.print();
    }, wasEdit ? 340 : 80);
  }
  const editing = mode === "edit";
  return /* @__PURE__ */ React.createElement("div", { className: "app density-" + t.density, style: appStyle }, /* @__PURE__ */ React.createElement("div", { className: "toolbar" }, /* @__PURE__ */ React.createElement("div", { className: "tb-brand" }, /* @__PURE__ */ React.createElement("span", { className: "tb-word" }, "STORM", /* @__PURE__ */ React.createElement("span", { className: "t" }, "SAFE"), "\xA0STEEL"), /* @__PURE__ */ React.createElement("span", { className: "sub" }, "Building Approval Sheet")), /* @__PURE__ */ React.createElement("div", { className: "spacer" }), /* @__PURE__ */ React.createElement("div", { className: "style-chips" }, /* @__PURE__ */ React.createElement("span", { className: "lbl" }, "STYLE"), STYLES.map((s) => /* @__PURE__ */ React.createElement(
    "button",
    {
      key: s.key,
      className: "chip" + (t.style === s.key ? " on" : ""),
      onClick: () => setTweak("style", s.key)
    },
    s.label
  ))), /* @__PURE__ */ React.createElement("div", { className: "seg", role: "tablist" }, /* @__PURE__ */ React.createElement("button", { className: editing ? "on" : "", onClick: () => setMode("edit") }, /* @__PURE__ */ React.createElement("svg", { width: "15", height: "15", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2" }, /* @__PURE__ */ React.createElement("path", { d: "M12 20h9" }), /* @__PURE__ */ React.createElement("path", { d: "M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" })), "Edit"), /* @__PURE__ */ React.createElement("button", { className: !editing ? "on" : "", onClick: () => {
    setSelectedId(null);
    setPlaceType(null);
    setMode("sheet");
  } }, /* @__PURE__ */ React.createElement("svg", { width: "15", height: "15", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2" }, /* @__PURE__ */ React.createElement("path", { d: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" }), /* @__PURE__ */ React.createElement("path", { d: "M14 2v6h6" })), "Approval Sheet")), /* @__PURE__ */ React.createElement("button", { className: "tbtn tbtn-primary", onClick: doPrint }, /* @__PURE__ */ React.createElement("svg", { width: "16", height: "16", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2" }, /* @__PURE__ */ React.createElement("path", { d: "M6 9V2h12v7" }), /* @__PURE__ */ React.createElement("path", { d: "M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" }), /* @__PURE__ */ React.createElement("rect", { x: "6", y: "14", width: "12", height: "8" })), "Save PDF"), /* @__PURE__ */ React.createElement("button", { className: "tbtn" + (tweaksOpen ? " on" : ""), onClick: toggleTweaks, title: "Style & building tweaks" }, /* @__PURE__ */ React.createElement("svg", { width: "16", height: "16", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2" }, /* @__PURE__ */ React.createElement("line", { x1: "4", y1: "21", x2: "4", y2: "14" }), /* @__PURE__ */ React.createElement("line", { x1: "4", y1: "10", x2: "4", y2: "3" }), /* @__PURE__ */ React.createElement("line", { x1: "12", y1: "21", x2: "12", y2: "12" }), /* @__PURE__ */ React.createElement("line", { x1: "12", y1: "8", x2: "12", y2: "3" }), /* @__PURE__ */ React.createElement("line", { x1: "20", y1: "21", x2: "20", y2: "16" }), /* @__PURE__ */ React.createElement("line", { x1: "20", y1: "12", x2: "20", y2: "3" }), /* @__PURE__ */ React.createElement("line", { x1: "1", y1: "14", x2: "7", y2: "14" }), /* @__PURE__ */ React.createElement("line", { x1: "9", y1: "8", x2: "15", y2: "8" }), /* @__PURE__ */ React.createElement("line", { x1: "17", y1: "16", x2: "23", y2: "16" })), "Tweaks")), /* @__PURE__ */ React.createElement("div", { className: "work" + (editing ? "" : " preview-only") }, editing && /* @__PURE__ */ React.createElement(
    Editor,
    {
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
      onSaveLayout: saveLayout,
      onLoadLayout: loadLayout,
      onDeleteLayout: deleteLayout
    }
  ), /* @__PURE__ */ React.createElement("div", { className: "canvas" }, editing && /* @__PURE__ */ React.createElement("div", { className: "canvas-bar" }, /* @__PURE__ */ React.createElement("span", { className: "cb-lbl" }, "Frames"), /* @__PURE__ */ React.createElement("button", { className: "cb-toggle" + (t.showFrames ? " on" : ""), onClick: () => setTweak("showFrames", !t.showFrames) }, /* @__PURE__ */ React.createElement("i", null), /* @__PURE__ */ React.createElement("span", null, t.showFrames ? "On" : "Off")), /* @__PURE__ */ React.createElement("span", { className: "cb-divider" }), /* @__PURE__ */ React.createElement("span", { className: "cb-lbl" }, "Elevation"), /* @__PURE__ */ React.createElement("button", { className: "cb-toggle" + (t.showElev ? " on" : ""), onClick: () => setTweak("showElev", !t.showElev) }, /* @__PURE__ */ React.createElement("i", null), /* @__PURE__ */ React.createElement("span", null, t.showElev ? "On" : "Off")), /* @__PURE__ */ React.createElement("div", { className: "cb-walls" + (t.showElev ? "" : " dim") }, WALL_CHIPS.map((w) => /* @__PURE__ */ React.createElement(
    "button",
    {
      key: w.key,
      className: "cb-wall" + (t.elevWall === w.key ? " on" : ""),
      disabled: !t.showElev,
      onClick: () => setTweak("elevWall", w.key)
    },
    w.label
  ))), /* @__PURE__ */ React.createElement("div", { className: "cb-spacer" }), /* @__PURE__ */ React.createElement("span", { className: "cb-tip" }, placeType ? "Click a wall to place \xB7 hold Alt for no snap" : selectedId ? "Drag to move (1\u2033 steps) \xB7 Alt = no snap \xB7 arrows nudge (Shift 6\u2033, \u2318 1\u2032) \xB7 Del removes" : "Drag openings \xB7 pick a type to add")), /* @__PURE__ */ React.createElement("div", { className: "canvas-stage view-" + mode, key: mode }, /* @__PURE__ */ React.createElement(
    Sheet,
    {
      building,
      docInfo,
      openings,
      tagMap,
      style: t.style,
      showDims: t.showDims,
      showFrames: t.showFrames,
      showElevation: t.showElev,
      elevWall: t.elevWall,
      selectedId: editing ? selectedId : null,
      onSelect: editing ? setSelectedId : null,
      placeType: editing ? placeType : null,
      onPlace: editing ? placeOpening : null,
      onMove: editing ? (id, patch) => setOpenings((prev) => prev.map((o) => o.id === id ? { ...o, ...patch } : o)) : null
    }
  )))), /* @__PURE__ */ React.createElement(TweaksPanel, null, /* @__PURE__ */ React.createElement(TweakSection, { label: "Sheet style" }), /* @__PURE__ */ React.createElement(
    TweakRadio,
    {
      label: "Direction",
      value: t.style,
      options: ["engineering", "stamp", "blueprint"],
      onChange: (v) => setTweak("style", v)
    }
  ), /* @__PURE__ */ React.createElement(
    TweakColor,
    {
      label: "Accent",
      value: t.accent,
      options: ["#14A6A0", "#0B1F3A", "#E84A1F", "#14A269"],
      onChange: (v) => setTweak("accent", v)
    }
  ), /* @__PURE__ */ React.createElement(
    TweakRadio,
    {
      label: "Density",
      value: t.density,
      options: ["compact", "regular", "comfy"],
      onChange: (v) => setTweak("density", v)
    }
  ), /* @__PURE__ */ React.createElement(
    TweakToggle,
    {
      label: "Dimension lines",
      value: t.showDims,
      onChange: (v) => setTweak("showDims", v)
    }
  ), /* @__PURE__ */ React.createElement(TweakSection, { label: "Elevation" }), /* @__PURE__ */ React.createElement(
    TweakToggle,
    {
      label: "Frame lines",
      value: t.showFrames,
      onChange: (v) => setTweak("showFrames", v)
    }
  ), /* @__PURE__ */ React.createElement(
    TweakToggle,
    {
      label: "Elevation on sheet",
      value: t.showElev,
      onChange: (v) => setTweak("showElev", v)
    }
  ), /* @__PURE__ */ React.createElement(
    TweakSelect,
    {
      label: "Elevation wall",
      value: t.elevWall,
      options: [{ value: "front", label: "Front" }, { value: "back", label: "Back" }, { value: "left", label: "Left" }, { value: "right", label: "Right" }],
      onChange: (v) => setTweak("elevWall", v)
    }
  ), /* @__PURE__ */ React.createElement(TweakSection, { label: "Building" }), /* @__PURE__ */ React.createElement(
    TweakRadio,
    {
      label: "Configuration",
      value: t.config || "enclosed",
      options: ["enclosed", "hybrid", "carport"],
      onChange: (v) => changeConfig({ config: v })
    }
  ), building.config === "hybrid" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(
    TweakRadio,
    {
      label: "Open end",
      value: t.openEnd || "front",
      options: ["front", "back"],
      onChange: (v) => changeConfig({ openEnd: v })
    }
  ), /* @__PURE__ */ React.createElement(
    TweakSlider,
    {
      label: "Carport length",
      value: t.openLength || 0,
      min: 4,
      max: Math.max(4, building.length - 4),
      step: 1,
      unit: "ft",
      onChange: (v) => setTweak("openLength", v)
    }
  )), /* @__PURE__ */ React.createElement(
    TweakSlider,
    {
      label: "Width",
      value: t.width,
      min: 12,
      max: 100,
      step: 1,
      unit: "ft",
      onChange: (v) => setTweak("width", v)
    }
  ), /* @__PURE__ */ React.createElement(
    TweakSlider,
    {
      label: "Length",
      value: t.length,
      min: 12,
      max: 200,
      step: 1,
      unit: "ft",
      onChange: (v) => setTweak("length", v)
    }
  ), /* @__PURE__ */ React.createElement(
    TweakSlider,
    {
      label: "Eave height",
      value: t.height,
      min: 8,
      max: 30,
      step: 1,
      unit: "ft",
      onChange: (v) => setTweak("height", v)
    }
  ), /* @__PURE__ */ React.createElement(
    TweakSlider,
    {
      label: "Wind rating",
      value: t.wind,
      min: 120,
      max: 200,
      step: 5,
      unit: "mph",
      onChange: (v) => setTweak("wind", v)
    }
  )));
}
ReactDOM.createRoot(document.getElementById("root")).render(/* @__PURE__ */ React.createElement(App, null));
