/* ============================================================
   Sheet.jsx — the client-facing approval document (print page).
   Plan diagram dominates; optional elevation band; no footer.
   ============================================================ */

function Sheet({ building, docInfo, openings, tagMap, style, showDims, showFrames = true,
                 showElevation, elevWall, selectedId, onSelect, onMove,
                 placeType, onPlace, revisionMode }) {
  const blueprint = style === 'blueprint';
  const today = docInfo.date && docInfo.date.trim() ? docInfo.date.trim() : '';
  const has = (s) => s && String(s).trim().length > 0;

  return (
    <div className={'sheet style-' + style + (showElevation ? ' has-elev' : '')}>
      {/* ---------- header (dark masthead) ---------- */}
      <div className="sheet-head">
        <div className="brand">
          <div className="wordmark"><span>STORM</span><span className="t">SAFE</span><span>&nbsp;STEEL</span></div>
          <div className="tagline">Hurricane-Rated Steel Buildings</div>
        </div>
        <div className="head-right">
          <div className="masthead">{revisionMode ? 'Revised Layout Approval' : 'Building Approval Sheet'}</div>
          {revisionMode && <div className="rev-badge-sheet">REVISION</div>}
        </div>
      </div>

      {/* ---------- customer / job info ---------- */}
      <div className="info-strip">
        <div className="info-cell">
          <div className="k">Customer</div>
          <div className="v">{has(docInfo.customer) ? docInfo.customer : '—'}</div>
        </div>
        {has(docInfo.address) && (
          <div className="info-cell">
            <div className="k">Building Site Address</div>
            <div className="v" style={{ fontWeight: 500, fontSize: '13px' }}>{docInfo.address}</div>
          </div>
        )}
        {has(docInfo.quoteNo) && (
          <div className="info-cell">
            <div className="k">Quote No.</div>
            <div className="v mono">{docInfo.quoteNo}</div>
            <div className="v" style={{ fontWeight: 500, fontSize: '12px', color: 'var(--fg-3)', marginTop: '2px' }}>Rev A{today ? ' · ' + today : ''}</div>
          </div>
        )}
        {has(docInfo.rep) && (
          <div className="info-cell">
            <div className="k">Prepared By</div>
            <div className="v">{docInfo.rep}</div>
          </div>
        )}
      </div>

      {/* ---------- revision info (only in revision mode) ---------- */}
      {revisionMode && (
        <div className="rev-strip">
          <div className="rev-strip-cell"><span className="rev-k">Revision #</span><span className="rev-v-line" /></div>
          <div className="rev-strip-cell"><span className="rev-k">Original Approval Date</span><span className="rev-v-line" /></div>
          <div className="rev-strip-cell"><span className="rev-k">Revision Date</span><span className="rev-v-line" /></div>
        </div>
      )}

      {/* ---------- building spec ---------- */}
      <div className="spec-row">
        <div className="spec-stat"><div className="n">{ftInTight(building.width)}<span className="u"> W</span></div><div className="l">Width</div></div>
        <div className="spec-stat"><div className="n">{ftInTight(building.length)}<span className="u"> L</span></div><div className="l">Length</div></div>
        <div className="spec-stat"><div className="n">{ftInTight(building.height)}</div><div className="l">Eave</div></div>
        <div className="spec-stat"><div className="n">{building.wind}<span className="u"> MPH</span></div><div className="l">Wind</div></div>
        <div className="spec-stat"><div className="n">{building.pitch}</div><div className="l">Pitch</div></div>
        <div className="spec-stat"><div className="n">{building.trussOC}′<span className="u"> OC</span></div><div className="l">Trusses</div></div>
        <div className="spec-stat"><div className="n">{GAUGES[building.gauge].label}</div><div className="l">Framing</div></div>
        <div className="spec-stat"><div className="n spec-stat-text">{LEG_TYPES[building.legType].short}</div><div className="l">Columns</div></div>
      </div>

      {/* ---------- config strip (hybrid/carport only) ---------- */}
      {building.config !== 'enclosed' && (
        <div className="frame-strip">
          <div className="fs-cell">
            <span className="fs-k">Config</span>
            <span className="fs-v">{CONFIG_LABEL[building.config]}
              {building.config === 'hybrid' && (
                <span className="fs-sub"> · {ftInTight(Math.max(0, building.length - building.openLength))} enclosed / {ftInTight(building.openLength)} {building.openEnd}{building.gableSheet === 'gable' ? ' · gable sheeted' : ''}</span>
              )}
            </span>
          </div>
        </div>
      )}

      {/* ---------- finishes strip ---------- */}
      {(() => {
        const fin = docInfo.finishes;
        if (!fin) return null;
        const slots = [
          { key: 'roof',  label: 'Roof' },
          { key: 'walls', label: 'Walls' },
          { key: 'trim',  label: 'Trim' },
        ];
        if (fin.hasWainscot) slots.push({ key: 'wainscot', label: 'Wainscot' });
        return (
          <div className="finish-strip">
            <div className="finish-strip-k">Finishes</div>
            {slots.map(s => {
              const v = fin[s.key];
              const named = catalogFor(docInfo.mfr || DEFAULT_MFR).colors[v];
              const sw = named ? colorSwatch(docInfo.mfr || DEFAULT_MFR, v) : (v && v[0] === '#' ? v : '#888');
              const nm = named ? named.name : (v && v[0] === '#' ? v.toUpperCase() : '—');
              const cd = named ? (named.code || '') : '';
              return (
                <div key={s.key} className="finish-strip-cell">
                  <span className="fsc-sw" style={{ background: sw }} />
                  <span className="fsc-text">
                    <span className="fsc-k">{s.label}</span>
                    <span className="fsc-v">{nm}{cd ? <span className="fsc-code"> · {cd}</span> : null}</span>
                  </span>
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* ---------- plan ---------- */}
      <div className="block-title">
        <h2>Opening Plan</h2>
        <span className="hint">{onMove ? '↔ Drag any opening · snaps + aligns · arrow keys to nudge' : 'Top view · all dimensions to opening edge'}</span>
      </div>
      <div className="plan-wrap">
        <PlanDiagram building={building} openings={openings} tagMap={tagMap}
          showDims={showDims} showFrames={showFrames} blueprint={blueprint}
          selectedId={selectedId} onSelect={onSelect} onMove={onMove}
          placeType={placeType} onPlace={onPlace} />
      </div>

      {/* ---------- elevation (optional) ---------- */}
      {showElevation && (
        <>
          <div className="block-title">
            <h2>{WALLS[elevWall].label} Elevation</h2>
            <span className="hint">Opening heights · {ftInTight(building.height)} eave</span>
          </div>
          <div className="elev-wrap">
            <Elevation building={building} openings={openings} tagMap={tagMap}
              wall={elevWall} blueprint={blueprint} compact />
          </div>
        </>
      )}

      {/* ---------- schedule ---------- */}
      <div className="block-title">
        <h2>Opening Schedule</h2>
        <span className="hint">Tags match plan callouts</span>
      </div>
      <Schedule building={building} openings={openings} tagMap={tagMap} />

      {/* ---------- changes summary (revision mode) ---------- */}
      {revisionMode && (
        <div className="rev-changes">
          <h2 className="rev-changes-title">Summary of Layout Changes</h2>
          <div className="rev-changes-lines">
            <div className="rev-ch-line" /><div className="rev-ch-line" /><div className="rev-ch-line" />
            <div className="rev-ch-line" /><div className="rev-ch-line" />
          </div>
        </div>
      )}

      {/* ---------- sign-off ---------- */}
      <div className="signoff">
        <div className="ack">
          {revisionMode ? (
            <><strong>Sign-off on revised layout.</strong> I have reviewed the revised opening locations, sizes,
            and layout changes described above. I approve this revised layout for production.
            Changes after production begins may incur additional cost and delay.</>
          ) : (
            <><strong>Customer approval.</strong> I have reviewed the openings shown above — type, size, wall, and
            position — and confirm they are correct. <strong>Fabrication begins on this layout</strong>.</>
          )}
        </div>
        <div className="sign-lines">
          <div className="sign-line">
            <div className="ln" />
            <div className="cap">Customer signature</div>
          </div>
          <div className="sign-line">
            <div className="ln" />
            <div className="cap">Date</div>
          </div>
          {revisionMode && (
            <div className="sign-line">
              <div className="ln" />
              <div className="cap">StormSafe rep signature / date</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

window.Sheet = Sheet;
