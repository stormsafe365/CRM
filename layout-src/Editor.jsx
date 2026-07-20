/* ============================================================
   Editor.jsx — left rail: building size, document info, the
   opening placement tool, and saved layouts.
   ============================================================ */

function DimField({ label, value, onChange, unit = 'ft', step = 1, min = 0 }) {
  return (
    <div className="field">
      <label>{label}</label>
      <div className="dim-input">
        <input type="number" value={value} step={step} min={min}
          onChange={e => onChange(e.target.value === '' ? '' : parseFloat(e.target.value))} />
        <span className="unit">{unit}</span>
      </div>
    </div>
  );
}

// Free-text dimension field. Accepts feet, inches, or a combo — 8'11", 23", 8.5.
// Shows the tidy ft′in″ interpretation under the field while editing so the
// user can confirm what was parsed. Commits on blur / Enter.
function DimTextField({ label, value, onChange }) {
  const [draft, setDraft] = React.useState(null);
  const text = draft != null ? draft : ftInTight(value);
  const parsed = draft != null ? parseFeet(draft) : value;
  const bad = draft != null && draft.trim() !== '' && parsed == null;
  function commit() {
    if (draft == null) return;
    const v = parseFeet(draft);
    if (v != null && v > 0) onChange(Math.round(v * 1000) / 1000);
    setDraft(null);
  }
  return (
    <div className="field">
      <label>{label}</label>
      <div className={'dim-input dim-text' + (bad ? ' bad' : '')}>
        <input type="text" inputMode="text" value={text}
          onChange={e => setDraft(e.target.value)}
          onFocus={e => { setDraft(ftInTight(value)); requestAnimationFrame(() => e.target.select()); }}
          onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') { commit(); e.target.blur(); } if (e.key === 'Escape') { setDraft(null); e.target.blur(); } }} />
      </div>
      <div className="dim-hint">{bad ? "Try 8'11\", 23\", or 8.5" : (draft != null && parsed != null ? ftIn(parsed) : 'ft \u00b7 in \u00b7 8\u203211\u2033')}</div>
    </div>
  );
}

// Color picker for a single finish slot (roof / walls / trim / wainscot).
// Renders the current swatch + name, opens a curated swatch grid + custom-hex
// input on click. Closes when a swatch is picked or on outside click.
function FinishPicker({ label, value, mfr, onChange }) {
  const [open, setOpen] = React.useState(false);
  const [customHex, setCustomHex] = React.useState('');
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!open) return;
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  const cat = catalogFor(mfr);
  const namedEntry = cat.colors[value];
  const isNamed = !!namedEntry;
  const swatchVal = isNamed ? colorSwatch(mfr, value) : (value && value[0] === '#' ? value : '#888');
  const labelText = isNamed ? colorLabel(mfr, value) : (value && value[0] === '#' ? 'Custom ' + value.toUpperCase() : 'Pick color');
  const codeText = isNamed ? colorCode(mfr, value) : '';
  function commitCustom() {
    const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(customHex.trim());
    if (!m) return;
    onChange('#' + m[1].toUpperCase());
    setCustomHex('');
    setOpen(false);
  }
  return (
    <div className="finish-row" ref={ref}>
      <div className="finish-key">{label}</div>
      <button className={'finish-btn' + (open ? ' open' : '')} onClick={() => setOpen(o => !o)}>
        <span className="finish-swatch" style={{ background: swatchVal }} />
        <span className="finish-name-wrap">
          <span className="finish-name">{labelText}</span>
          {codeText && <span className="finish-code">{codeText}</span>}
        </span>
        <svg className="finish-caret" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && (
        <div className="finish-pop">
          <div className="finish-grid">
            {cat.order.map(k => {
              const c = cat.colors[k];
              return (
                <button key={k} className={'finish-sw' + (value === k ? ' on' : '')}
                  title={c.name + (c.code ? ' · ' + c.code : '')}
                  onClick={() => { onChange(k); setOpen(false); }}>
                  <span className="finish-sw-chip" style={{ background: colorSwatch(mfr, k) }} />
                  <span className="finish-sw-text">
                    <span className="finish-sw-name">{c.name}</span>
                    {c.code && <span className="finish-sw-code">{c.code}</span>}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="finish-custom">
            <span className="finish-custom-lbl">Custom hex</span>
            <input value={customHex} placeholder="#1A2B3C"
              onChange={e => setCustomHex(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') commitCustom(); }} />
            <button className="finish-custom-add" onClick={commitCustom}>Use</button>
          </div>
        </div>
      )}
    </div>
  );
}

function TypeSwatch({ t }) {
  return <span className="swatch" style={{ background: t.color }} />;
}

// segmented control for framing specs (truss OC, gauge, leg type)
function StructSeg({ options, value, onChange }) {
  return (
    <div className="struct-seg">
      {options.map(o => (
        <button key={o.value} className={'struct-opt' + (o.value === value ? ' on' : '')}
          onClick={() => onChange(o.value)}>
          <span className="so-main">{o.main}</span>
          {o.sub && <span className="so-sub">{o.sub}</span>}
        </button>
      ))}
    </div>
  );
}

function Editor({ building, t, setTweak, changeConfig, docInfo, setDocInfo, openings, setOpenings,
                  selectedId, setSelectedId, placeType, setPlaceType,
                  savedLayouts, onSaveLayout, onLoadLayout, onDeleteLayout }) {

  const [removing, setRemoving] = React.useState({});
  const [savingName, setSavingName] = React.useState(false);
  const [nameDraft, setNameDraft] = React.useState('');
  const [flashIds, setFlashIds] = React.useState({});

  // Quick-Add form state — typed numeric placement without clicking the plan.
  const [quickOpen, setQuickOpen] = React.useState(false);
  const [quickWall, setQuickWall] = React.useState('front');
  const [quickOffset, setQuickOffset] = React.useState('');

  // Trigger a 1.1s 'just-added' flash on the newest opening id
  function flash(id) {
    setFlashIds(m => ({ ...m, [id]: true }));
    setTimeout(() => setFlashIds(m => { const n = { ...m }; delete n[id]; return n; }), 1100);
  }
  React.useEffect(() => {
    const onAdd = (e) => { if (e.detail && e.detail.id) flash(e.detail.id); };
    window.addEventListener('opening-added', onAdd);
    return () => window.removeEventListener('opening-added', onAdd);
  }, []);

  React.useEffect(() => {
    // keep the quick-add wall valid as configuration changes
    const valid = visibleWalls(building);
    if (!valid.includes(quickWall)) setQuickWall(valid[0]);
  }, [building.config, building.openEnd]);

  function update(id, patch) {
    setOpenings(prev => prev.map(o => o.id === id ? { ...o, ...patch } : o));
  }
  function remove(id) {
    setRemoving(r => ({ ...r, [id]: true }));
    if (selectedId === id) setSelectedId(null);
    setTimeout(() => {
      setOpenings(prev => prev.filter(o => o.id !== id));
      setRemoving(r => { const n = { ...r }; delete n[id]; return n; });
    }, 200);
  }
  function toggleType(k) {
    setPlaceType(placeType === k ? null : k);
    setSelectedId(null);
  }
  function commitSave() {
    const name = nameDraft.trim();
    if (!name) { setSavingName(false); return; }
    onSaveLayout(name);
    setNameDraft('');
    setSavingName(false);
  }

  const tagMap = window.__tagMap || {};

  return (
    <aside className="rail">
      <h3 className="rail-title">Layout Builder</h3>
      <div className="rail-sub">Place openings, then switch to Approval Sheet to review &amp; export.</div>

      {/* ---------- Building ---------- */}
      <div className="section-label">Building</div>
      <div className="grid-3">
        <DimField label="Width" value={t.width} onChange={v => setTweak('width', v)} />
        <DimField label="Length" value={t.length} onChange={v => setTweak('length', v)} />
        <DimField label="Eave" value={t.height} onChange={v => setTweak('height', v)} />
      </div>
      <div className="grid-2">
        <DimField label="Wind rating" value={t.wind} unit="mph" step={5} onChange={v => setTweak('wind', v)} />
        <div className="field">
          <label>Roof pitch</label>
          <input value={t.pitch} onChange={e => setTweak('pitch', e.target.value)} />
        </div>
      </div>

      {/* ---------- Finishes & Color ---------- */}
      <div className="section-label">Finishes &amp; Color</div>
      {(() => {
        const fin = docInfo.finishes || DEFAULT_FINISHES;
        const mfr = docInfo.mfr || DEFAULT_MFR;
        function setFin(patch) { setDocInfo({ ...docInfo, finishes: { ...fin, ...patch } }); }
        function setMfr(next) {
          if (next === mfr) return;
          const migrated = migrateFinishes(fin, mfr, next);
          setDocInfo({ ...docInfo, mfr: next, finishes: migrated });
        }
        const slots = [
          { key: 'roof',  label: 'Roof' },
          { key: 'walls', label: 'Walls' },
          { key: 'trim',  label: 'Trim' },
        ];
        if (fin.hasWainscot) slots.push({ key: 'wainscot', label: 'Wainscot' });
        return (
          <>
            <div className="mfr-row" title="Internal only — does not appear on the client approval sheet">
              <span className="mfr-k">Catalog
                <span className="mfr-private" aria-label="Internal only">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
                  Internal
                </span>
              </span>
              <div className="mfr-seg">
                {MFR_ORDER.map(k => (
                  <button key={k} className={'mfr-opt' + (mfr === k ? ' on' : '')} onClick={() => setMfr(k)}>
                    {COLOR_CATALOGS[k].label}
                  </button>
                ))}
              </div>
            </div>
            <div className="finish-list">
              {slots.map(s => (
                <FinishPicker key={s.key} label={s.label} value={fin[s.key]} mfr={mfr} onChange={v => setFin({ [s.key]: v })} />
              ))}
            </div>
            <button className={'wainscot-toggle' + (fin.hasWainscot ? ' on' : '')}
              onClick={() => setFin({ hasWainscot: !fin.hasWainscot })}>
              <span className="ws-dot" />
              <span>{fin.hasWainscot ? 'Wainscot enabled' : 'Add wainscot'}</span>
              {fin.hasWainscot && <span className="ws-remove">Remove</span>}
            </button>
          </>
        );
      })()}
      <div className="section-label">Configuration</div>
      <StructSeg value={building.config}
        onChange={v => changeConfig({ config: v })}
        options={[
          { value: 'enclosed', main: 'Enclosed', sub: 'Fully sheeted' },
          { value: 'hybrid',   main: 'Hybrid',   sub: 'Garage + Carport' },
          { value: 'carport',  main: 'Carport',  sub: 'Open structure' },
        ]} />
      {building.config === 'hybrid' && (
        <div style={{ marginTop: 'var(--space-3)' }}>
          <div className="struct-field">
            <div className="struct-head"><label>Open carport end</label><span className="struct-note">{building.openEnd === 'front' ? 'Open extends forward' : 'Open extends rearward'}</span></div>
            <StructSeg value={building.openEnd}
              onChange={v => changeConfig({ openEnd: v })}
              options={[
                { value: 'front', main: 'Front', sub: 'Front gable open' },
                { value: 'back',  main: 'Back',  sub: 'Back gable open' },
              ]} />
          </div>
          <div className="struct-field">
            <div className="struct-head"><label>Open-end sheeting</label><span className="struct-note">{building.gableSheet === 'gable' ? 'Peak triangle is sheeted' : 'Fully open at the eave'}</span></div>
            <StructSeg value={building.gableSheet}
              onChange={v => setTweak('gableSheet', v)}
              options={[
                { value: 'open',  main: 'Open',         sub: 'No gable sheeting' },
                { value: 'gable', main: 'Gable Only',   sub: 'Peak sheeted' },
              ]} />
          </div>
          <div className="grid-2">
            <DimField label="Enclosed" value={Math.max(0, building.length - building.openLength)} step={1}
              onChange={v => {
                const enc = Math.max(0, Math.min(building.length, Number(v) || 0));
                setTweak('openLength', Math.max(0, Math.min(building.length, building.length - enc)));
              }} />
            <DimField label="Carport" value={building.openLength} step={1}
              onChange={v => setTweak('openLength', Math.max(0, Math.min(building.length, Number(v) || 0)))} />
          </div>
          <div className="helper" style={{ marginTop: '2px' }}>
            Additional End Wall sits {ftInTight(building.openEnd === 'back' ? building.openLength : (building.length - building.openLength))} from the back
            · carport extends {ftInTight(building.openLength)} from the {building.openEnd}.
          </div>
        </div>
      )}
      {building.config === 'carport' && (
        <div className="helper" style={{ marginTop: 'var(--space-2)' }}>
          Open structure — roof + frame only, no sheeted walls. Place frame-outs to mark structural posts.
        </div>
      )}

      {/* ---------- Framing & structure ---------- */}
      {(() => {
        const tOpts = trussOptions(building.width);
        const baseOC = baseTrussOC(building.width);
        const legOpts = legOptions(building.width, building.height);
        const baseLeg = baseLegType(building.width, building.height);
        const legForced = legOpts.length === 1;
        const legReason = building.width >= 32
          ? `${ftInTight(building.width)} wide → ladder legs required`
          : `${ftInTight(building.height)} eave → ${LEG_TYPES[baseLeg].label.toLowerCase()} minimum`;
        return (
          <>
            <div className="section-label">Framing &amp; Structure</div>

            <div className="struct-field">
              <div className="struct-head"><label>Truss spacing</label><span className="struct-note">{baseOC}′ standard for {ftInTight(building.width)} wide</span></div>
              <StructSeg value={building.trussOC} onChange={v => setTweak('trussOC', v)}
                options={tOpts.map(oc => ({ value: oc, main: oc + '′ OC', sub: oc === baseOC ? 'Standard' : 'Upgrade' }))} />
              <div className="struct-helper">{frameCount(building.length, building.trussOC)} frames across {ftInTight(building.length)} · trusses on the eave (length) sides.</div>
            </div>

            <div className="struct-field">
              <div className="struct-head"><label>Framing gauge</label><span className="struct-note">{GAUGES[building.gauge].tube} tube</span></div>
              <StructSeg value={building.gauge} onChange={v => setTweak('gauge', v)}
                options={GAUGE_ORDER.map(g => ({ value: g, main: GAUGES[g].label, sub: GAUGES[g].tube }))} />
            </div>

            <div className="struct-field">
              <div className="struct-head"><label>Column / leg type</label>{legForced && <span className="struct-note struct-lock">Auto</span>}</div>
              <StructSeg value={building.legType} onChange={v => setTweak('legType', v)}
                options={legOpts.map(k => ({ value: k, main: LEG_TYPES[k].short, sub: LEG_TYPES[k].range }))} />
              <div className="struct-helper">{LEG_TYPES[building.legType].desc}. {legForced ? legReason + '.' : 'Upgrade available.'}</div>
            </div>
          </>
        );
      })()}

      {/* ---------- Document ---------- */}
      <div className="section-label">Document Info</div>
      <div className="field">
        <label>Customer</label>
        <input value={docInfo.customer} onChange={e => setDocInfo({ ...docInfo, customer: e.target.value })} />
      </div>
      <div className="field">
        <label>Building site address</label>
        <textarea value={docInfo.address} onChange={e => setDocInfo({ ...docInfo, address: e.target.value })} />
      </div>
      <div className="grid-2">
        <div className="field">
          <label>Quote no.</label>
          <input value={docInfo.quoteNo} onChange={e => setDocInfo({ ...docInfo, quoteNo: e.target.value })} />
        </div>
        <div className="field">
          <label>Rep</label>
          <input value={docInfo.rep} onChange={e => setDocInfo({ ...docInfo, rep: e.target.value })} />
        </div>
      </div>

      {/* ---------- Add opening (click-to-place + Quick Add) ---------- */}
      <div className="section-label">Add Opening</div>
      <div className={'place-hint' + (placeType ? ' on' : '')}>
        {placeType
          ? <><b>Placing {OPENING_TYPES[placeType].label}.</b> Click any wall on the plan to drop one. Keep clicking to add more. <b>Esc</b> to stop.</>
          : <>Pick a type, then click any wall on the plan. Or use <b>Quick Add</b> below for an exact position.</>}
      </div>
      <div className="type-grid">
        {TYPE_ORDER.map(k => {
          const ot = OPENING_TYPES[k];
          return (
            <button key={k} className={'type-card' + (placeType === k ? ' arming' : '')}
              onClick={() => toggleType(k)}>
              <TypeSwatch t={ot} />
              <span>{ot.label}</span>
            </button>
          );
        })}
      </div>

      {/* Quick Add — manual numeric placement */}
      <button className={'quick-add-toggle' + (quickOpen ? ' on' : '')}
        onClick={() => setQuickOpen(q => !q)}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M12 5v14M5 12h14" /></svg>
        Quick Add
        <svg className={'qa-caret' + (quickOpen ? ' open' : '')} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {quickOpen && (() => {
        const armed = placeType || 'rollup';
        const def = OPENING_TYPES[armed];
        const wl = wallLength(quickWall, building);
        const offNum = Math.max(0, Math.min(wl - def.w, Number(quickOffset) || 0));
        const refLbl = (quickWall === 'left' || quickWall === 'right') ? 'BACK' : 'LEFT';
        const farLbl = (quickWall === 'left' || quickWall === 'right') ? 'FRONT' : 'RIGHT';
        const farDist = Math.max(0, wl - offNum - def.w);
        function commit() {
          if (!quickOffset && quickOffset !== 0) { setQuickOffset('0'); return; }
          const op = makeOpening(armed, quickWall, offNum);
          setOpenings(prev => [...prev, op]);
          setSelectedId(op.id);
          flash(op.id);
          setQuickOffset('');
        }
        return (
          <div className="quick-add">
            <div className="qa-row">
              <div className="qa-field">
                <label>Type</label>
                <select value={armed} onChange={e => setPlaceType(e.target.value)}>
                  {TYPE_ORDER.map(k => <option key={k} value={k}>{OPENING_TYPES[k].label}</option>)}
                </select>
              </div>
              <div className="qa-field">
                <label>Wall</label>
                <select value={quickWall} onChange={e => setQuickWall(e.target.value)}>
                  {visibleWalls(building).map(w => <option key={w} value={w}>{w === 'divider' ? 'Additional End Wall' : WALLS[w].label}</option>)}
                </select>
              </div>
            </div>
            <div className="qa-row">
              <div className="qa-field qa-offset">
                <label>From {refLbl} corner</label>
                <div className="dim-input">
                  <input type="number" step="0.5" min="0" max={Math.max(0, wl - def.w)}
                    placeholder="0"
                    value={quickOffset}
                    onChange={e => setQuickOffset(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') commit(); }} />
                  <span className="unit">ft</span>
                </div>
              </div>
              <button className="qa-add" onClick={commit}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14" /></svg>
                Add
              </button>
            </div>
            <div className="qa-preview">
              {def.w}′ × {def.h}′ · <b>{ftInTight(offNum)}</b> from {refLbl.toLowerCase()} · <b>{ftInTight(farDist)}</b> to {farLbl.toLowerCase()} · wall is {ftInTight(wl)}
            </div>
          </div>
        );
      })()}

      {/* ---------- Placed openings ---------- */}
      <div className="section-label">Placed · {openings.length}</div>
      {openings.length === 0 && <div className="empty-note">No openings yet. Pick a type above and click the plan to start.</div>}
      <div className="op-list">
        {openings.map(op => {
          const ot = OPENING_TYPES[op.type];
          const isOpen = selectedId === op.id;
          const wl = wallLength(op.wall, building);
          return (
            <div key={op.id} className={'op-row' + (isOpen ? ' open sel' : '') + (removing[op.id] ? ' removing' : '') + (flashIds[op.id] ? ' just-added' : '')}>
              <div className="op-row-head" onClick={() => setSelectedId(isOpen ? null : op.id)}>
                <span className="op-tag" style={{ background: ot.color }}>{tagMap[op.id] || '•'}</span>
                <span className="op-name">{op.name && op.name.trim() ? op.name.trim() : ot.label}</span>
                <span className="op-meta-wall">{op.wall === 'divider' ? 'Add. End Wall' : WALLS[op.wall].label}</span>
                <span className="op-size">{sizeLabel(op)}</span>
                <svg className="caret" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M9 6l6 6-6 6" /></svg>
              </div>
              {isOpen && (
                <div className="op-body">
                  <div className="grid-2">
                    <div className="field">
                      <label>Type</label>
                      <select value={op.type} onChange={e => {
                        const nt = OPENING_TYPES[e.target.value];
                        update(op.id, { type: e.target.value, w: nt.w, h: nt.h });
                      }}>
                        {TYPE_ORDER.map(k => <option key={k} value={k}>{OPENING_TYPES[k].label}</option>)}
                      </select>
                    </div>
                    <div className="field">
                      <label>Wall</label>
                      <select value={op.wall} onChange={e => update(op.id, { wall: e.target.value })}>
                        {visibleWalls(building).map(w => <option key={w} value={w}>{w === 'divider' ? 'Additional End Wall' : WALLS[w].label}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="grid-2">
                    <DimTextField label="Width" value={op.w} onChange={v => update(op.id, { w: v })} />
                    <DimTextField label="Height" value={op.h} onChange={v => update(op.id, { h: v })} />
                  </div>
                  {(() => {
                    const isEave = op.wall === 'left' || op.wall === 'right';
                    const nearRef = isEave ? 'Back' : 'Left';
                    const farRef  = isEave ? 'Front' : 'Right';
                    const farDist = Math.max(0, wl - op.offset - op.w);
                    return (
                      <div className="grid-2">
                        <DimField label={`From ${nearRef}`} value={op.offset} step={0.5}
                          onChange={v => update(op.id, { offset: Math.max(0, Math.min(wl - op.w, Number(v) || 0)) })} />
                        <DimField label={`From ${farRef}`} value={Number(farDist.toFixed(3))} step={0.5}
                          onChange={v => {
                            const f = Math.max(0, Math.min(wl - op.w, Number(v) || 0));
                            update(op.id, { offset: Math.max(0, wl - op.w - f) });
                          }} />
                      </div>
                    );
                  })()}
                  {(() => {
                    // spacing to neighboring openings on the same wall
                    const sibs = openings.filter(o => o.wall === op.wall && o.id !== op.id).slice().sort((a, b) => a.offset - b.offset);
                    const prev = sibs.filter(o => o.offset + o.w <= op.offset + 0.001).slice(-1)[0];
                    const next = sibs.find(o => o.offset >= op.offset + op.w - 0.001);
                    const prevGap = prev ? op.offset - (prev.offset + prev.w) : null;
                    const nextGap = next ? next.offset - (op.offset + op.w) : null;
                    const farDist2 = Math.max(0, wl - op.offset - op.w);
                    const overflow = op.offset + op.w > wl + 0.01;
                    return (
                      <div className="spacing-helper">
                        {overflow ? (
                          <span className="sp-warn">⚠ Extends past corner — reduce position or width.</span>
                        ) : (
                          <>
                            <span className="sp-row"><b>{ftInTight(op.offset)}</b> from {(op.wall === 'left' || op.wall === 'right') ? 'back' : 'left'} · <b>{ftInTight(farDist2)}</b> from {(op.wall === 'left' || op.wall === 'right') ? 'front' : 'right'} · wall {ftInTight(wl)}</span>
                            {(prev || next) && (
                              <span className="sp-row sp-row-2">
                                {prev && <>← <b>{ftInTight(prevGap)}</b> to {tagMap[prev.id] != null ? `·${tagMap[prev.id]}` : 'prev'}</>}
                                {prev && next && <span className="sp-sep">·</span>}
                                {next && <><b>{ftInTight(nextGap)}</b> to {tagMap[next.id] != null ? `·${tagMap[next.id]}` : 'next'} →</>}
                              </span>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })()}
                  {op.type === 'window' && (
                    <DimTextField label="Sill height (off floor)" value={op.sill} onChange={v => update(op.id, { sill: v })} />
                  )}
                  {(op.type === 'custom' || op.type === 'framed') && (
                    <div className="field">
                      <label>Product / label</label>
                      <input value={op.name} placeholder={op.type === 'custom' ? 'e.g. Equipment bay' : 'Optional label'}
                        onChange={e => update(op.id, { name: e.target.value })} />
                    </div>
                  )}
                  <div className="field">
                    <label>Note</label>
                    <input value={op.note} placeholder="Optional — e.g. on right side of wall" onChange={e => update(op.id, { note: e.target.value })} />
                  </div>
                  <div className="op-actions">
                    <button className="mini-btn" onClick={() => {
                      const dup = makeOpening(op.type, op.wall, Math.min(op.offset + 2, Math.max(0, wl - op.w)), { w: op.w, h: op.h, sill: op.sill, name: op.name, note: op.note });
                      setOpenings(prev => [...prev, dup]); setSelectedId(dup.id); flash(dup.id);
                    }}>Duplicate</button>
                    <button className="op-del" onClick={() => remove(op.id)}>Remove</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ---------- Saved layouts ---------- */}
      <div className="section-label">Saved Layouts</div>
      {savingName ? (
        <div className="save-row">
          <input autoFocus value={nameDraft} placeholder="Name this layout…"
            onChange={e => setNameDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') commitSave(); if (e.key === 'Escape') setSavingName(false); }} />
          <button className="mini-btn primary" onClick={commitSave}>Save</button>
        </div>
      ) : (
        <button className="save-btn" onClick={() => { setNameDraft(docInfo.customer ? docInfo.customer.split('—')[0].trim() : ''); setSavingName(true); }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" /><path d="M17 21v-8H7v8M7 3v5h8" /></svg>
          Save current layout
        </button>
      )}
      {savedLayouts.length === 0 && <div className="empty-note" style={{ marginTop: '8px' }}>No saved layouts yet.</div>}
      <div className="saved-list">
        {savedLayouts.map(L => (
          <div key={L.id} className="saved-row">
            <button className="saved-load" onClick={() => onLoadLayout(L.id)}>
              <span className="sl-name">{L.name}</span>
              <span className="sl-meta">{ftInTight(L.building.width)}×{ftInTight(L.building.length)} · {L.openings.length} opening{L.openings.length === 1 ? '' : 's'}</span>
            </button>
            <button className="saved-del" title="Delete" onClick={() => onDeleteLayout(L.id)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /></svg>
            </button>
          </div>
        ))}
      </div>
      <div style={{ height: '40px' }} />
    </aside>
  );
}

window.Editor = Editor;
