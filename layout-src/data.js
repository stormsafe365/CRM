/* ============================================================
   data.js — opening types, defaults, formatting helpers
   Plain JS, attached to window for use across babel scripts.
   Dimensions are stored in DECIMAL FEET; displayed as ft′in″.
   ============================================================ */

// Opening type catalog. color = CSS var used in plan + schedule + legend.
const OPENING_TYPES = {
  rollup:  { key: 'rollup',  label: 'Roll-Up Door',     abbr: 'RU', color: 'var(--storm-500)', w: 10,    h: 10,   swing: false },
  walk:    { key: 'walk',    label: 'Walk Door',        abbr: 'WD', color: 'var(--teal-500)',  w: 3,     h: 6.667, swing: true  },
  double:  { key: 'double',  label: 'Double Walk Door', abbr: 'DD', color: 'var(--teal-700)',  w: 6,     h: 6.667, swing: true  },
  window:  { key: 'window',  label: 'Window',           abbr: 'WN', color: 'var(--navy-500)',  w: 3,     h: 4,    swing: false },
  sliding: { key: 'sliding', label: 'Sliding Door',     abbr: 'SD', color: 'var(--safe-500)',  w: 12,    h: 12,   swing: false },
  framed:  { key: 'framed',  label: 'Frame Out',        abbr: 'FO', color: 'var(--steel-600)', w: 10,    h: 10,   swing: false },
  custom:  { key: 'custom',  label: 'Custom Frame Out', abbr: 'CF', color: 'var(--navy-700)',  w: 8,     h: 8,    swing: false },
};

const TYPE_ORDER = ['rollup', 'walk', 'double', 'window', 'sliding', 'framed', 'custom'];

// Walls, with their plan position and the building dimension they span.
const WALLS = {
  front:   { key: 'front',   label: 'Front',               spans: 'width',  ref: 'Left' },
  back:    { key: 'back',    label: 'Back',                spans: 'width',  ref: 'Left' },
  left:    { key: 'left',    label: 'Left',                spans: 'length', ref: 'Back' },
  right:   { key: 'right',   label: 'Right',               spans: 'length', ref: 'Back' },
  divider: { key: 'divider', label: 'Additional End Wall', spans: 'width',  ref: 'Left' },
};
// Render order for tag numbering. Divider is grouped last so its tag numbers stay stable.
const WALL_ORDER = ['front', 'right', 'back', 'left', 'divider'];

// Open-gable sheeting for the carport end. 'open' = fully open peak.
// 'gable' = peak triangle is sheeted, but the rectangle below the eave stays open.
function isOpenGable(b, wall) {
  return isHybrid(b) && wall === b.openEnd;
}
function openGableMode(b) {
  // 'open' | 'gable'  (default 'open' when missing for back-compat).
  return b && b.gableSheet === 'gable' ? 'gable' : 'open';
}

// ---- formatting: decimal feet -> 12′ 6″ ----
function ftIn(value) {
  if (value == null || isNaN(value)) return '—';
  const neg = value < 0;
  let v = Math.abs(value);
  let ft = Math.floor(v + 1e-6);
  let inch = Math.round((v - ft) * 12);
  if (inch === 12) { ft += 1; inch = 0; }
  let out = ft + '′';
  if (inch > 0) out += ' ' + inch + '″';
  return (neg ? '-' : '') + out;
}

// compact (no space) for tight labels: 10′ or 6′8″
function ftInTight(value) {
  if (value == null || isNaN(value)) return '—';
  let v = Math.abs(value);
  let ft = Math.floor(v + 1e-6);
  let inch = Math.round((v - ft) * 12);
  if (inch === 12) { ft += 1; inch = 0; }
  return inch > 0 ? `${ft}′${inch}″` : `${ft}′`;
}

function sizeLabel(op) {
  return `${ftInTight(op.w)} × ${ftInTight(op.h)}`;
}

// ---- parse a dimension string -> decimal feet ----
// Accepts: 8'11"  ·  8' 11  ·  8ft 11in  ·  23"  ·  23in  ·  8.5  ·  8.5'  ·  8
// Rule: a bare number with NO marks is read as FEET. A bare number that is
// clearly inches ( ends in " or in ) becomes feet/12. Combos add the two.
function parseFeet(raw) {
  if (raw == null) return null;
  let s = String(raw).trim().toLowerCase();
  if (s === '') return null;
  s = s.replace(/’/g, "'").replace(/[”″]/g, '"').replace(/[‘′]/g, "'");
  // explicit feet + inches, e.g. 8'11"  or  8 ft 11 in
  let m = s.match(/^(-?\d*\.?\d+)\s*(?:'|ft|feet)\s*(\d*\.?\d+)?\s*(?:"|in|inch|inches)?$/);
  if (m) {
    const ft = parseFloat(m[1]) || 0;
    const inch = m[2] != null ? parseFloat(m[2]) : 0;
    return ft + inch / 12;
  }
  // inches only, e.g. 23"  or  23in
  m = s.match(/^(-?\d*\.?\d+)\s*(?:"|in|inch|inches)$/);
  if (m) return parseFloat(m[1]) / 12;
  // bare number -> feet (decimal ok)
  m = s.match(/^(-?\d*\.?\d+)$/);
  if (m) return parseFloat(m[1]);
  return null;
}

// wall length in feet for a given building
function wallLength(wallKey, building) {
  return WALLS[wallKey].spans === 'width' ? building.width : building.length;
}

let _uid = 0;
function newId() {
  // Random base + counter -> collision-proof across reloads, multiple instances,
  // and React double-invoke (StrictMode) of useState initializers.
  return 'op' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + (_uid++);
}
// Kept for back-compat; the new id scheme doesn't need it.
function bumpIdsPast() {}

function makeOpening(typeKey, wallKey, offset, overrides = {}) {
  const t = OPENING_TYPES[typeKey];
  return {
    id: newId(),
    type: typeKey,
    wall: wallKey,
    offset: offset,           // ft from wall reference corner to NEAR edge of opening
    w: t.w,
    h: t.h,
    sill: typeKey === 'window' ? 3 : 0,  // ft off floor (windows)
    name: '',                 // custom label (for custom frame outs etc.)
    note: '',
    ...overrides,
  };
}

// ---- roof / elevation geometry ----
// pitch "3:12" -> slope (rise per 1 run). "3/12" also accepted.
function parsePitch(p) {
  if (p == null) return 0;
  const m = String(p).split(/[:\/]/);
  const rise = parseFloat(m[0]);
  const run = parseFloat(m[1] != null ? m[1] : '12');
  if (isNaN(rise) || isNaN(run) || run === 0) return 0;
  return rise / run;
}
// gable peak height for a building (ridge runs along the LENGTH; gable ends are
// the front/back/width walls).
function peakHeight(building) {
  return building.height + (building.width / 2) * parsePitch(building.pitch);
}
// is this wall a gable end (true) or an eave side (false)?
function isGableWall(wallKey) { return wallKey === 'front' || wallKey === 'back'; }

// vertical reference lines for a wall: head (top of opening) and eave.
function openingTop(op) { return (op.sill || 0) + op.h; }

// ---- framing / structure ----
// Gauge: lower number = heavier steel. 12 ga is the heavy-duty upgrade.
const GAUGES = {
  '14': { label: '14 ga', tube: '2″ × 2″', note: 'Standard' },
  '12': { label: '12 ga', tube: '2″ × 2″', note: 'Heavy-duty' },
};
const GAUGE_ORDER = ['14', '12'];

// Leg types, ordered weakest -> strongest (upgrade direction).
const LEG_TYPES = {
  single: { label: 'Single Leg', short: 'Single', desc: 'One vertical tube column', range: 'Up to 12′' },
  double: { label: 'Double Leg', short: 'Double', desc: 'Two columns side-by-side', range: '13′–16′' },
  ladder: { label: 'Ladder Leg', short: 'Ladder', desc: 'Parallel posts + step bracing', range: '17′+ or 32′+ wide' },
};
const LEG_ORDER = ['single', 'double', 'ladder'];

// Truss on-center spacing rules.
// >24′ wide  -> 4′ standard (never 5′); 2′ is an upgrade.
// ≤24′ wide  -> 5′ standard; 4′ and 2′ are upgrades.
function baseTrussOC(width) { return width > 24 ? 4 : 5; }
function trussOptions(width) { return width > 24 ? [4, 2] : [5, 4, 2]; }
function normalizeTrussOC(width, current) {
  const opts = trussOptions(width);
  const c = Number(current);
  return opts.includes(c) ? c : baseTrussOC(width);
}

// Leg-type rules from wall height + width. 32′+ wide is always ladder.
function baseLegType(width, height) {
  if (width >= 32) return 'ladder';
  if (height >= 17) return 'ladder';
  if (height >= 13) return 'double';
  return 'single';
}
// allowed selections = base and anything stronger (you can upgrade, not downgrade
// below the engineering minimum).
function legOptions(width, height) {
  return LEG_ORDER.slice(LEG_ORDER.indexOf(baseLegType(width, height)));
}
function normalizeLegType(width, height, current) {
  const opts = legOptions(width, height);
  return opts.includes(current) ? current : baseLegType(width, height);
}

// Frame stations along the LENGTH (trusses every `oc` feet, starting from
// the back endwall; final bay may be shorter if length isn't a clean
// multiple of OC). Mirrors construction practice for the rendering.
function frameStations(length, oc) {
  if (length <= 0 || oc <= 0) return [0];
  const EPS = 0.001;
  const out = [];
  let p = 0;
  while (p < length - EPS) { out.push(p); p += oc; }
  out.push(length);
  return out;
}
function frameCount(length, oc) { return frameStations(length, oc).length; }

// ---- hybrid (garage / carport) configuration -----------------------------
// config: 'enclosed' | 'hybrid' | 'carport'
//   enclosed: full perimeter walls, no divider
//   hybrid:   one gable end (openEnd) is the open carport, divider sits at
//             length = openLength measured from that open end. Enclosed zone
//             is the other (length - openLength) feet of the building.
//   carport:  no walls at all (openLength = length, no divider needed).
// openEnd: which gable end the open carport extends from ('front' | 'back')
// openLength: feet of the carport zone (0…length).

function normalizeConfig(b) {
  const cfg = b && b.config;
  if (cfg === 'hybrid' || cfg === 'carport') return cfg;
  return 'enclosed';
}
function isHybrid(b) { return normalizeConfig(b) === 'hybrid'; }
function isCarport(b) { return normalizeConfig(b) === 'carport'; }
function hasDivider(b) { return isHybrid(b) && (b.openLength || 0) > 0.01 && (b.openLength || 0) < b.length - 0.01; }

// Position of the divider as measured along the length axis from the BACK wall
// (length=0). openEnd='front' -> divider sits at enclosedLength from back.
// openEnd='back'  -> divider sits at (length - enclosedLength) from back.
function dividerLengthPos(b) {
  if (!isHybrid(b)) return null;
  const oL = Math.max(0, Math.min(b.length, Number(b.openLength) || 0));
  return b.openEnd === 'back' ? oL : (b.length - oL);
}
// Enclosed and open zones as [startFt, endFt] measured along the length
// from the back wall. Useful for the plan view + range checks.
function enclosedZone(b) {
  if (isCarport(b)) return null;
  if (!isHybrid(b)) return [0, b.length];
  const dp = dividerLengthPos(b);
  return b.openEnd === 'back' ? [dp, b.length] : [0, dp];
}
function openZone(b) {
  if (isCarport(b)) return [0, b.length];
  if (!isHybrid(b)) return null;
  const dp = dividerLengthPos(b);
  return b.openEnd === 'back' ? [0, dp] : [dp, b.length];
}
// Which walls are visible/sheeted for the current config.
function wallSheeted(b, wallKey) {
  if (isCarport(b)) return false;
  if (!isHybrid(b)) return wallKey !== 'divider';
  if (wallKey === 'divider') return true;
  if (wallKey === b.openEnd) return false;          // open gable
  return true;                                       // back wall + side walls always sheeted in hybrid
}
// Wall keys to render / pick from in the current config.
function visibleWalls(b) {
  if (isCarport(b)) return ['front', 'right', 'back', 'left'];
  if (isHybrid(b)) return ['front', 'right', 'back', 'left', 'divider'];
  return ['front', 'right', 'back', 'left'];
}

// Migrate openings when configuration changes.
// Rule (per user): user-placed side-wall openings stay put. Only openings on
// the gable that BECOMES open (or stops being open) are auto-moved.
//   enclosed -> hybrid  : openings on the new-open gable -> divider
//   hybrid   -> enclosed: divider openings -> the previously-open gable
//   hybrid openEnd swap : openings on the new-open gable -> divider; if any
//                          existed on the new-enclosed gable they stay (none
//                          should, since they were migrated last time).
function migrateOpenings(oldB, newB, openings) {
  const oldCfg = normalizeConfig(oldB);
  const newCfg = normalizeConfig(newB);
  if (oldCfg === newCfg && (oldB.openEnd || 'front') === (newB.openEnd || 'front')) return openings;
  return openings.map(o => {
    // hybrid -> non-hybrid: divider openings fall back to the previously-open gable
    if (oldCfg === 'hybrid' && newCfg !== 'hybrid' && o.wall === 'divider') {
      return { ...o, wall: oldB.openEnd || 'front' };
    }
    // non-hybrid -> hybrid: openings on the new-open gable migrate to divider
    if (oldCfg !== 'hybrid' && newCfg === 'hybrid' && o.wall === (newB.openEnd || 'front')) {
      return { ...o, wall: 'divider' };
    }
    // hybrid openEnd swap: openings on the new-open gable migrate to divider.
    if (oldCfg === 'hybrid' && newCfg === 'hybrid' && o.wall === (newB.openEnd || 'front')
        && o.wall !== (oldB.openEnd || 'front')) {
      return { ...o, wall: 'divider' };
    }
    return o;
  });
}

// ---- Steel building color palettes ----
// Two manufacturer catalogs. Internal-only — the manufacturer name is
// shown to the team but NEVER printed on the client-facing approval sheet.
// Each color entry: { name, hex, code, swatch? }. `code` is optional (CCI
// uses color name only; CA carries a specific manufacturer code).
const COLOR_CATALOGS = {
  ca: {
    label: 'CA',
    colors: {
      arcticWhite:    { name: 'Arctic White',     hex: '#E6EBEC', code: '' },
      brightWhite:    { name: 'Bright White',     hex: '#D9D6D2', code: 'WXD0049L' },
      ivory:          { name: 'Ivory',            hex: '#E5C8B0', code: 'WXD0045L' },
      lightStone:     { name: 'Light Stone',      hex: '#C9B097', code: 'WXD0038L' },
      saharaTan:      { name: 'Sahara Tan',       hex: '#B58A65', code: 'WXD0046L' },
      clay:           { name: 'Clay',             hex: '#9D7E78', code: 'WXD0047L' },
      cocoaBrown:     { name: 'Cocoa Brown',      hex: '#5C3825', code: 'WXB1008L' },
      lightGray:      { name: 'Light Gray',       hex: '#A4A6A7', code: 'WXA0095L' },
      charcoal:       { name: 'Charcoal',         hex: '#5C5C5C', code: 'WXA0090L' },
      burnishedSlate: { name: 'Burnished Slate',  hex: '#54453B', code: 'WXB107L'  },
      black:          { name: 'Black',            hex: '#0F0F0F', code: 'WXA0107L' },
      galvalume:      { name: 'Galvalume',        hex: '#B5B6B3', code: 'GALV',     swatch: 'linear-gradient(135deg,#E2E3E0 0%,#9FA09D 35%,#D2D3D0 60%,#A8A9A6 100%)' },
      hawaiianBlue:   { name: 'Hawaiian Blue',    hex: '#356881', code: 'WXL0027L' },
      ivyGreen:       { name: 'Ivy Green',        hex: '#1F4937', code: 'WXG0020L' },
      brightRed:      { name: 'Bright Red',       hex: '#9F1F25', code: 'WXR0084'  },
      barnRed:        { name: 'Barn Red',         hex: '#82332C', code: 'WXR0077L' },
      burgundy:       { name: 'Burgundy',         hex: '#5B1F25', code: 'WXR0081L' },
      copperPenny:    { name: 'Copper Penny',     hex: '#B7702A', code: 'KM2Y49352' },
    },
    order: [
      'arcticWhite', 'brightWhite', 'ivory', 'lightStone', 'saharaTan', 'clay', 'cocoaBrown',
      'lightGray', 'charcoal', 'burnishedSlate', 'black',
      'galvalume',
      'hawaiianBlue', 'ivyGreen', 'brightRed', 'barnRed', 'burgundy', 'copperPenny',
    ],
    defaults: { roof: 'galvalume', walls: 'saharaTan', trim: 'burnishedSlate', wainscot: 'burnishedSlate' },
  },
  cci: {
    label: 'CCI',
    colors: {
      white:          { name: 'White',            hex: '#E9E6DE', code: '' },
      pebbleBeige:    { name: 'Pebble Beige',     hex: '#D6C6A2', code: '' },
      sandstone:      { name: 'Sandstone',        hex: '#CBB68B', code: '' },
      tan:            { name: 'Tan',              hex: '#AC8E64', code: '' },
      clay:           { name: 'Clay',             hex: '#B6A487', code: '' },
      earthBrown:     { name: 'Earth Brown',      hex: '#6E4B30', code: '' },
      pewterGray:     { name: 'Pewter Gray',      hex: '#918D85', code: '' },
      quakerGray:     { name: 'Quaker Gray',      hex: '#5A5C5A', code: '' },
      black:          { name: 'Black',            hex: '#0F0F0F', code: '' },
      galvalume:      { name: 'Galvalume',        hex: '#B5B6B3', code: '',        swatch: 'linear-gradient(135deg,#E2E3E0 0%,#9FA09D 35%,#D2D3D0 60%,#A8A9A6 100%)' },
      slateBlue:      { name: 'Slate Blue',       hex: '#4A6478', code: '' },
      kingBlue:       { name: 'King Blue',        hex: '#1F7AB5', code: '' },
      evergreen:      { name: 'Evergreen',        hex: '#1E3F33', code: '' },
      cardinalRed:    { name: 'Cardinal Red',     hex: '#C9282C', code: '' },
      barnRed:        { name: 'Barn Red',         hex: '#B14823', code: '' },
      merlot:         { name: 'Merlot',           hex: '#5C1A22', code: '' },
      burgundy:       { name: 'Burgundy',         hex: '#471920', code: '' },
    },
    order: [
      'white', 'pebbleBeige', 'sandstone', 'tan', 'clay', 'earthBrown',
      'pewterGray', 'quakerGray', 'black',
      'galvalume',
      'slateBlue', 'kingBlue', 'evergreen',
      'cardinalRed', 'barnRed', 'merlot', 'burgundy',
    ],
    defaults: { roof: 'galvalume', walls: 'tan', trim: 'black', wainscot: 'black' },
  },
};
const MFR_ORDER = ['ca', 'cci'];
const DEFAULT_MFR = 'ca';

function catalogFor(mfr) {
  return COLOR_CATALOGS[mfr] || COLOR_CATALOGS[DEFAULT_MFR];
}
function colorSwatch(mfr, key) {
  const c = catalogFor(mfr).colors[key];
  if (!c) return null;
  return c.swatch || c.hex;
}
function colorLabel(mfr, key) {
  const c = catalogFor(mfr).colors[key];
  return c ? c.name : (key || '—');
}
function colorCode(mfr, key) {
  const c = catalogFor(mfr).colors[key];
  return c ? (c.code || '') : '';
}
// When switching catalogs, migrate finish keys to the new catalog. Strategy:
//   1. exact key match (galvalume / black exist in both)
//   2. same display name (Burgundy / Pebble Beige / Clay overlap)
//   3. fall back to the new catalog's default for that slot
function migrateFinishes(finishes, fromMfr, toMfr) {
  if (fromMfr === toMfr) return finishes;
  const from = catalogFor(fromMfr).colors;
  const to = catalogFor(toMfr);
  const toNames = Object.fromEntries(Object.entries(to.colors).map(([k, v]) => [v.name.toLowerCase(), k]));
  function migrateOne(slot, val) {
    if (!val) return val;
    if (val[0] === '#') return val;            // custom hex passes through
    if (to.colors[val]) return val;            // same key works in both
    const old = from[val];
    if (old && toNames[old.name.toLowerCase()]) return toNames[old.name.toLowerCase()];
    return to.defaults[slot] || to.order[0];
  }
  return {
    ...finishes,
    roof:     migrateOne('roof',     finishes.roof),
    walls:    migrateOne('walls',    finishes.walls),
    trim:     migrateOne('trim',     finishes.trim),
    wainscot: migrateOne('wainscot', finishes.wainscot),
  };
}

const DEFAULT_FINISHES = {
  ...COLOR_CATALOGS[DEFAULT_MFR].defaults,
  hasWainscot: false,
};

const CONFIG_LABEL = {
  enclosed: 'Fully Enclosed',
  hybrid:   'Garage / Carport Hybrid',
  carport:  'Carport',
};

// ---- localStorage: saved layouts + working-state autosave ----
const LS_LAYOUTS = 'stormsafe.layouts.v2';
const LS_CURRENT = 'stormsafe.current.v2';
function loadLayouts() {
  try { return JSON.parse(localStorage.getItem(LS_LAYOUTS)) || []; }
  catch (e) { return []; }
}
function persistLayouts(arr) {
  try { localStorage.setItem(LS_LAYOUTS, JSON.stringify(arr)); } catch (e) {}
}
function loadCurrent() {
  try { return JSON.parse(localStorage.getItem(LS_CURRENT)); }
  catch (e) { return null; }
}
function persistCurrent(state) {
  try { localStorage.setItem(LS_CURRENT, JSON.stringify(state)); } catch (e) {}
}
function uniqueId() { return 'L' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

// ---- default building + openings (mirrors the supplied sketch) ----
const DEFAULT_BUILDING = {
  width: 40, length: 50, height: 16,
  wind: 150, snow: 20,
  pitch: '3:12',
  trussOC: 4, gauge: '14', legType: 'ladder',
  config: 'enclosed',
  openEnd: 'front',
  openLength: 0,
  gableSheet: 'open',
  customer: '',
  address: '',
  quoteNo: '',
  rep: '',
  date: '',
};

function defaultOpenings() {
  return [
    makeOpening('rollup', 'front', 6.667),
    makeOpening('rollup', 'front', 23.333),
    makeOpening('window', 'back', 17, { w: 6, h: 6, sill: 4 }),
    makeOpening('walk', 'right', 43.5),
    makeOpening('window', 'left', 12, { sill: 4 }),
    makeOpening('window', 'left', 35, { sill: 4 }),
  ];
}

Object.assign(window, {
  OPENING_TYPES, TYPE_ORDER, WALLS, WALL_ORDER,
  ftIn, ftInTight, sizeLabel, parseFeet, wallLength, makeOpening, newId, bumpIdsPast,
  DEFAULT_BUILDING, defaultOpenings,
  parsePitch, peakHeight, isGableWall, openingTop,
  GAUGES, GAUGE_ORDER, LEG_TYPES, LEG_ORDER,
  baseTrussOC, trussOptions, normalizeTrussOC,
  baseLegType, legOptions, normalizeLegType, frameStations, frameCount,
  normalizeConfig, isHybrid, isCarport, hasDivider, dividerLengthPos,
  enclosedZone, openZone, wallSheeted, visibleWalls, migrateOpenings, CONFIG_LABEL,
  isOpenGable, openGableMode,
  COLOR_CATALOGS, MFR_ORDER, DEFAULT_MFR, catalogFor, colorSwatch, colorLabel, colorCode, migrateFinishes, DEFAULT_FINISHES,
  LS_LAYOUTS, LS_CURRENT, loadLayouts, persistLayouts, loadCurrent, persistCurrent, uniqueId,
});
