/* ============================================================
   app.jsx — state, mode + style switching, tweaks, keyboard,
   save/load, place-mode, elevation controls.
   ============================================================ */

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "style": "engineering",
  "accent": "#14A6A0",
  "density": "regular",
  "showFrames": true,
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
}/*EDITMODE-END*/;

function computeTagMap(openings) {
  const order = { front: 0, right: 1, back: 2, left: 3, divider: 4 };
  const sorted = openings.slice().sort((a, b) => {
    if ((order[a.wall] || 0) !== (order[b.wall] || 0)) return (order[a.wall] || 0) - (order[b.wall] || 0);
    return a.offset - b.offset;
  });
  const map = {};
  sorted.forEach((o, i) => { map[o.id] = i + 1; });
  return map;
}

// Opened from the CRM (LayoutSheetModal adds ?embed=crm): the builder shows ONLY
// the quote it is seeded with. Owner 10/7: a quote's 30x50x12 sheet showed
// 40x50x16 + "size was changed here" while the quote was still being read —
// the last session's openings / lean-tos came back from localStorage but the
// building size did not (it was never saved), so the builder's DEFAULT size
// (TWEAK_DEFAULTS 40x50x16) met the previous quote's lean-tos. Embedded: nothing
// is restored or saved, and a "Loading the quote" panel shows until the seed.
const EMBED = /[?&]embed=crm\b/.test(location.search);
const BUILDING_KEYS = ['width', 'length', 'height', 'wind', 'pitch', 'trussOC', 'gauge', 'legType', 'config', 'openEnd', 'openLength', 'gableSheet'];

function App() {
  const restored = React.useRef(EMBED ? null : loadCurrent());
  // standalone: the saved building comes back WITH its openings / lean-tos (never one without the other)
  const [t, setTweak] = useTweaks((() => {
    const b = restored.current && restored.current.building;
    const keep = {};
    if (b && typeof b === 'object') BUILDING_KEYS.forEach(k => { if (b[k] != null) keep[k] = b[k]; });
    return { ...TWEAK_DEFAULTS, ...keep };
  })());
  const [mode, setMode] = React.useState(EMBED ? 'sheet' : 'edit');
  const [seeded, setSeeded] = React.useState(!EMBED);
  const [openings, setOpenings] = React.useState(() => {
    if (EMBED) return [];
    const ops = (restored.current && Array.isArray(restored.current.openings) && restored.current.openings.length)
      ? restored.current.openings : defaultOpenings();
    bumpIdsPast(ops);
    return ops;
  });
  const [selectedId, setSelectedId] = React.useState(null);
  const [placeType, setPlaceType] = React.useState(null);
  const [tweaksOpen, setTweaksOpen] = React.useState(false);
  const [revisionMode, setRevisionMode] = React.useState(false);
  const [savedLayouts, setSavedLayouts] = React.useState(() => {
    const layouts = loadLayouts();
    layouts.forEach(L => bumpIdsPast(L.openings));
    return layouts;
  });
  const [docInfo, setDocInfo] = React.useState(() => {
    const r = restored.current && restored.current.docInfo;
    const base = r || {
      customer: DEFAULT_BUILDING.customer,
      address: DEFAULT_BUILDING.address,
      quoteNo: DEFAULT_BUILDING.quoteNo,
      rep: DEFAULT_BUILDING.rep,
      date: '',
    };
    // Backfill finishes + manufacturer on older saved docInfo so they always exist.
    return {
      ...base,
      mfr: base.mfr || DEFAULT_MFR,
      finishes: { ...DEFAULT_FINISHES, ...(base.finishes || {}) },
    };
  });

  // ── CRM bridge (window.SS_LAYOUT) ─────────────────────────────────────────
  // Lets the CRM's LayoutSheetModal (opened from a lead's Document Hub) seed
  // this builder from the lead, and pull the finished approval sheet back as
  // standalone HTML so the CRM can render it to PDF and file it under "Layout".
  const docInfoRef = React.useRef(docInfo);
  docInfoRef.current = docInfo;
  const stateRef = React.useRef(null);
  stateRef.current = { mode, openings, geom: docInfo.geom || null, selectedId };
  React.useEffect(() => {
    function seedFromCRM(d) {
      if (!d) return;
      // size / building / openings / finishes / notes — see crmTweaks etc. in data.js
      const edits = crmTweaks(d);
      if (Object.keys(edits).length) setTweak(edits);
      if (Array.isArray(d.openings)) {
        setOpenings(crmOpenings(d.openings));
        setSelectedId(null); setPlaceType(null);
      }
      setDocInfo(prev => crmDocInfo(prev, d));
      // Seeded from a quote: open straight on the Approval Sheet (the new
      // design, owner 10/6); Edit is the secondary button.
      if (d.building || Array.isArray(d.openings)) { setSelectedId(null); setPlaceType(null); setMode('sheet'); }
      setSeeded(true);
    }
    function customerName() {
      return (docInfoRef.current && docInfoRef.current.customer) || '';
    }
    // Async: switches to the Approval Sheet, lets it paint, then returns a
    // self-contained HTML document (sheet markup + inlined CSS).
    async function getSheetHtml() {
      setMode('sheet');
      await new Promise(r => setTimeout(r, 450));
      // the paginated document (SheetDoc: page 1 + elevation pages), else the single sheet
      const el = document.querySelector('.sheet-doc') || document.querySelector('.sheet');
      if (!el) return '';
      const base = location.href.replace(/[^/]*$/, ''); // .../layout/
      let css = '';
      for (const link of Array.from(document.querySelectorAll('link[rel="stylesheet"]'))) {
        try { css += await (await fetch(link.href)).text() + '\n'; } catch (e) { /* ignore */ }
      }
      // styles.css @imports the token sheet — pull those in, then drop the @import lines.
      const imports = Array.from(css.matchAll(/@import\s+url\(['"]?([^'")]+)['"]?\)\s*;/g)).map(m => m[1]);
      for (const rel of imports) {
        try { css += await (await fetch(new URL(rel, base).href)).text() + '\n'; } catch (e) { /* ignore */ }
      }
      // Whole @import statements only: a Google Fonts URL carries ';' inside it
      // ("wght@400;500"), and cutting at the first ';' left its tail in the CSS,
      // which swallowed the next rule (the token sheet's :root -> no colours /
      // fonts in the filed PDF).
      // Remote ones (the brand fonts) go back at the very top, where @import is valid.
      const IMP = /@import\s+url\((['"]?)([^'")]*)\1\)[^;]*;/g;
      const remote = Array.from(new Set(Array.from(css.matchAll(IMP)).map(m => m[2]).filter(u => /^https?:/.test(u))));
      css = remote.map(u => "@import url('" + u + "');").join('\n') + '\n' + css.replace(IMP, '');
      // Relative url(...) refs must become absolute to resolve in the PDF renderer.
      css = css.replace(/url\((['"]?)(?!data:|https?:|\/|#)/g, (mm, q) => 'url(' + q + base);
      return '<!doctype html><html><head><meta charset="utf-8"><style>' + css +
        '\nbody{margin:0;background:#fff}.sheet-doc{margin:0 auto;gap:0}</style></head><body>' + el.outerHTML + '</body></html>';
    }
    // read-only snapshot (headless checks / support): what the sheet is drawing
    function state() { return JSON.parse(JSON.stringify(stateRef.current)); }
    // the CRM's top bar drives these (one bar, 10-6e) and hears the state back (postMessage below)
    function showMode(m) { setSelectedId(null); setPlaceType(null); setMode(m === 'edit' ? 'edit' : 'sheet'); }
    function toggleRevision() { setRevisionMode(r => !r); }
    function print() { showMode('sheet'); setTimeout(() => { try { window.focus(); window.print(); } catch (e) { /* ignore */ } }, 400); }
    window.SS_LAYOUT = { seedFromCRM, getSheetHtml, customerName, state, setMode: showMode, toggleRevision, print };
    return () => { try { delete window.SS_LAYOUT; } catch (e) { window.SS_LAYOUT = undefined; } };
  }, [setTweak]);

  const building = (() => {
    const width = Number(t.width) || 0;
    const height = Number(t.height) || 0;
    const length = Number(t.length) || 0;
    const config = normalizeConfig({ config: t.config });
    const openEnd = t.openEnd === 'back' ? 'back' : 'front';
    const openLength = config === 'hybrid'
      ? Math.max(0, Math.min(length, Number(t.openLength) || 0))
      : (config === 'carport' ? length : 0);
    return {
      width, height, length,
      wind: Number(t.wind) || 0,
      pitch: t.pitch || '3:12',
      trussOC: normalizeTrussOC(width, t.trussOC),
      gauge: String(t.gauge || '14'),
      legType: normalizeLegType(width, height, t.legType),
      config, openEnd, openLength,
      gableSheet: t.gableSheet === 'gable' ? 'gable' : 'open',
      notes: Array.isArray(docInfo.notes) ? docInfo.notes : [], // CRM quote notes (lean-tos etc.) → schedule
    };
  })();

  // Change building configuration with automatic opening migration. Used by Editor.
  function changeConfig(patch) {
    const oldB = building;
    const newB = {
      ...oldB,
      ...patch,
      config: patch.config != null ? normalizeConfig({ config: patch.config }) : oldB.config,
    };
    if (newB.config === 'enclosed') newB.openLength = 0;
    if (newB.config === 'carport') newB.openLength = newB.length;
    if (newB.config === 'hybrid' && (!newB.openLength || newB.openLength <= 0)) newB.openLength = Math.max(8, Math.round(newB.length / 2));
    const migrated = migrateOpenings(oldB, newB, openings);
    if (migrated !== openings) setOpenings(migrated);
    setTweak({
      config: newB.config,
      openEnd: newB.openEnd,
      openLength: newB.openLength,
    });
  }

  const tagMap = computeTagMap(openings);
  window.__tagMap = tagMap;

  // ---- tell the CRM's top bar what is showing (embedded only) ----
  React.useEffect(() => {
    if (!EMBED) return;
    try { window.parent.postMessage({ type: 'ss-layout-state', mode, revisionMode, seeded }, '*'); } catch (e) { /* ignore */ }
  }, [mode, revisionMode, seeded]);

  // ---- autosave working state ----
  React.useEffect(() => {
    if (EMBED) return; // the CRM copy never writes the standalone builder's working state
    const b = {}; BUILDING_KEYS.forEach(k => { b[k] = t[k]; });
    persistCurrent({ openings, docInfo, building: b });
  }, [openings, docInfo, ...BUILDING_KEYS.map(k => t[k])]);

  // ---- tweaks panel: drive it directly so it works standalone (no host) ----
  React.useEffect(() => {
    const onMsg = (e) => {
      const ty = e && e.data && e.data.type;
      if (ty === '__activate_edit_mode') setTweaksOpen(true);
      else if (ty === '__deactivate_edit_mode' || ty === '__edit_mode_dismissed') setTweaksOpen(false);
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);
  function toggleTweaks() {
    const next = !tweaksOpen;
    setTweaksOpen(next);
    window.postMessage({ type: next ? '__activate_edit_mode' : '__deactivate_edit_mode' }, '*');
  }

  // ---- place-mode handler ----
  // Continuous: keep placing the same type until the user cancels (Esc, clicks
  // the type again, or switches modes). The list pulses the newly-placed row.
  // move one lean-to opening (program-frame x) — the quote's geometry carried in docInfo.geom
  function moveLtOpening(ref, x) {
    setDocInfo(prev => ({ ...prev, geom: window.SheetGeom.setLtOpeningX(prev.geom, ref, x) }));
  }

  function placeOpening(wall, off) {
    if (!placeType) return;
    const op = makeOpening(placeType, wall, off);
    setOpenings(prev => [...prev, op]);
    setSelectedId(op.id);
    // Fire a custom event so Editor can flash the new row.
    window.dispatchEvent(new CustomEvent('opening-added', { detail: { id: op.id } }));
    // intentionally NOT clearing placeType — stay armed for the next click
  }

  // ---- keyboard: nudge / delete / cancel ----
  React.useEffect(() => {
    function onKey(e) {
      const tag = (e.target && e.target.tagName) || '';
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target && e.target.isContentEditable);
      if (e.key === 'Escape') { setPlaceType(null); setSelectedId(null); return; }
      if (typing || mode !== 'edit') return;
      if (selectedId == null) return;
      const dirs0 = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 };
      // a lean-to opening (the quote's spot): arrows nudge it along its wall
      const ltRef = window.SheetGeom && window.SheetGeom.parseLtId(selectedId);
      if (ltRef) {
        if (!(e.key in dirs0)) return;
        e.preventDefault();
        const cur = window.SheetGeom.getLtOpening(docInfo.geom, ltRef);
        if (!cur) return;
        const step = (e.metaKey || e.ctrlKey) ? 1 : (e.shiftKey ? 0.5 : (1 / 12));
        moveLtOpening(ltRef, Math.round((cur.x + dirs0[e.key] * step) * 96) / 96);
        return;
      }
      const op = openings.find(o => o.id === selectedId);
      if (!op) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        setOpenings(prev => prev.filter(o => o.id !== selectedId));
        setSelectedId(null);
        return;
      }
      const dirs = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 };
      if (e.key in dirs) {
        e.preventDefault();
        // Nudge step: default 1″, Shift 6″, Ctrl/Cmd 1′. Fine control by default,
        // bigger moves when you ask for them.
        const step = (e.metaKey || e.ctrlKey) ? 1 : (e.shiftKey ? 0.5 : (1 / 12));
        const wl = wallLength(op.wall, building);
        let off = op.offset + dirs[e.key] * step;
        off = Math.round(off * 12) / 12;
        off = Math.max(0, Math.min(wl - op.w, off));
        setOpenings(prev => prev.map(o => o.id === selectedId ? { ...o, offset: off } : o));
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId, openings, mode, building.width, building.length, docInfo.geom]);

  // ---- save / load layouts ----
  function saveLayout(name) {
    const rec = {
      id: uniqueId(), name, savedAt: Date.now(),
      building: { ...building }, openings: openings.map(o => ({ ...o })), docInfo: { ...docInfo },
    };
    const next = [rec, ...savedLayouts].slice(0, 30);
    setSavedLayouts(next); persistLayouts(next);
  }
  function loadLayout(id) {
    const rec = savedLayouts.find(L => L.id === id);
    if (!rec) return;
    const b = rec.building || {};
    setTweak({
      width: b.width, length: b.length, height: b.height, wind: b.wind, pitch: b.pitch,
      trussOC: b.trussOC, gauge: b.gauge, legType: b.legType,
      config: b.config || 'enclosed',
      openEnd: b.openEnd || 'front',
      openLength: b.openLength || 0,
      gableSheet: b.gableSheet || 'open',
    });
    setOpenings(rec.openings.map(o => ({ ...o })));
    setDocInfo({ ...rec.docInfo });
    setSelectedId(null); setPlaceType(null);
  }
  function deleteLayout(id) {
    const next = savedLayouts.filter(L => L.id !== id);
    setSavedLayouts(next); persistLayouts(next);
  }

  // expose accent + density to CSS
  const appStyle = {
    '--ss-accent': t.accent,
    '--ss-accent-hover': 'color-mix(in srgb, ' + t.accent + ' 86%, black)',
    '--ss-accent-press': 'color-mix(in srgb, ' + t.accent + ' 72%, black)',
    '--teal-500': t.accent,
  };

  function fitForPrint() {
    // The paginated Approval Sheet prints page-for-page (each page is a letter
    // sheet, styles.css @media print) — nothing to squeeze.
    if (document.querySelector('.sheet-doc')) return;
    const sheet = document.querySelector('.sheet');
    if (!sheet) return;
    sheet.style.zoom = '';
    const PRINT_W = 816 - 2;
    const PRINT_H = 1056 - 2;
    const z = Math.min(PRINT_W / sheet.scrollWidth, PRINT_H / sheet.scrollHeight, 1);
    sheet.style.zoom = z.toFixed(4);
  }

  React.useEffect(() => {
    const before = () => fitForPrint();
    const after = () => { const s = document.querySelector('.sheet'); if (s) s.style.zoom = ''; };
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => { window.removeEventListener('beforeprint', before); window.removeEventListener('afterprint', after); };
  });

  function doPrint() {
    const wasEdit = mode === 'edit';
    if (wasEdit) { setSelectedId(null); setPlaceType(null); setMode('sheet'); }
    setTimeout(() => { fitForPrint(); window.print(); }, wasEdit ? 340 : 80);
  }

  const editing = mode === 'edit';

  return (
    <div className={'app density-' + t.density + (EMBED ? ' is-embed' : '')} style={appStyle}>
      {/* ---------- toolbar (standalone only: inside the CRM the ONE top bar is the CRM's, 10-6e) ---------- */}
      <div className="toolbar" style={EMBED ? { display: 'none' } : null}>
        <div className="tb-brand">
          <span className="tb-word">STORM<span className="t">SAFE</span>&nbsp;STEEL</span>
          <span className="sub">Building Approval Sheet</span>
        </div>
        <div className="spacer" />

        <div className="seg" role="tablist">
          <button className={!editing ? 'on' : ''} data-mode="sheet" onClick={() => { setSelectedId(null); setPlaceType(null); setMode('sheet'); }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6" /></svg>
            Approval Sheet
          </button>
          <button className={editing ? 'on' : ''} data-mode="edit" onClick={() => setMode('edit')}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
            Edit layout
          </button>
        </div>

        <button className={'tbtn' + (revisionMode ? ' tbtn-rev-on' : ' tbtn-rev')} onClick={() => setRevisionMode(r => !r)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /><path d="M15 5l3 3" /></svg>
          {revisionMode ? 'Original' : 'Revision'}
        </button>

        <button className="tbtn tbtn-primary" onClick={doPrint}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9V2h12v7" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><rect x="6" y="14" width="12" height="8" /></svg>
          Save PDF
        </button>

      </div>

      {/* ---------- work area ---------- */}
      {!seeded && (
        <div className="seed-wait" role="status"><span className="seed-dot" />Loading the quote&hellip;</div>
      )}
      {seeded && (
      <div className={'work' + (editing ? '' : ' preview-only')}>
        {editing && (
          <Editor building={building} t={t} setTweak={setTweak}
            changeConfig={changeConfig}
            docInfo={docInfo} setDocInfo={setDocInfo}
            openings={openings} setOpenings={setOpenings}
            selectedId={selectedId} setSelectedId={setSelectedId}
            placeType={placeType} setPlaceType={setPlaceType}
            savedLayouts={savedLayouts} onSaveLayout={saveLayout}
            onLoadLayout={loadLayout} onDeleteLayout={deleteLayout} />
        )}
        <div className="canvas">
          {editing && (
            <div className="canvas-bar">
              <span className="cb-lbl">Frames</span>
              <button className={'cb-toggle' + (t.showFrames ? ' on' : '')} onClick={() => setTweak('showFrames', !t.showFrames)}>
                <i /><span>{t.showFrames ? 'On' : 'Off'}</span>
              </button>
              <div className="cb-spacer" />
              <span className="cb-tip">{placeType ? 'Click a wall on the plan or an elevation to place · hold Alt for no snap' : (selectedId ? 'Drag on the plan or its elevation (1″ steps) · Alt = no snap · arrows nudge (Shift 6″, ⌘ 1′) · Del removes' : 'Drag openings on the plan or the elevations · pick a type to add')}</span>
            </div>
          )}
          <div className={'canvas-stage view-' + mode} key={mode}>
            <Sheet building={building} docInfo={docInfo} openings={openings} tagMap={tagMap}
              showFrames={t.showFrames}
              revisionMode={revisionMode}
              onMoveLt={editing ? moveLtOpening : null}
              selectedId={editing ? selectedId : null}
              onSelect={editing ? setSelectedId : null}
              placeType={editing ? placeType : null}
              onPlace={editing ? placeOpening : null}
              onMove={editing ? ((id, patch) => setOpenings(prev => prev.map(o => o.id === id ? { ...o, ...patch } : o))) : null} />
          </div>
        </div>
      </div>
      )}

    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
