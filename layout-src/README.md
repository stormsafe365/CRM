# Handoff: StormSafe Steel — Building Opening Approval Sheet Builder

## Overview
An internal sales tool for **StormSafe Steel** reps. A rep configures a prefab steel
building (size, framing, config, finishes), lays out door/window/frame-out **openings**
on a to-scale top-down plan by dragging or clicking, and produces a **one-page,
client-facing approval sheet** the customer signs off on before fabrication begins.

Two modes in one screen:
- **Edit** — left rail of controls + interactive plan; the rep builds the layout.
- **Approval Sheet** — the print/PDF-ready client document (no editing chrome).

The output is engineered to print on **exactly one US-Letter page (portrait)** with the
plan drawing as large as possible.

## About the Design Files
The files in this bundle are **design references created in HTML/React-via-Babel** —
a working prototype showing the intended look and behavior. They are **not** meant to be
shipped as-is. The task is to **recreate this tool in the target codebase's environment**
(e.g. a real React app with a bundler, or Vue/Svelte/etc.) using its established patterns,
build system, and state/persistence libraries. If no environment exists yet, pick the most
appropriate modern framework (React + Vite recommended — the component split maps 1:1) and
implement there.

The prototype loads React 18 + Babel Standalone from CDN and compiles `.jsx` in the browser.
In production you'd compile ahead of time and drop the CDN/Babel dependency.

## Fidelity
**High-fidelity (hifi).** Final colors, typography, spacing, geometry, and interactions.
The plan and elevation drawings are mathematically to-scale SVG and should be reproduced
faithfully — the measurements shown are real and customers rely on them. Recreate pixel-
and behavior-accurately using the codebase's libraries.

## Architecture (current prototype)
Plain global-scope Babel scripts, each attaching exports to `window`. Load order matters
(see `index.html`):

| File | Role |
|---|---|
| `data.js` | Pure logic + constants: opening types, walls, color catalogs, framing rules, geometry + parsing helpers, localStorage layer, defaults. **No React.** Start here. |
| `tweaks-panel.jsx` | Reusable slide-in "Tweaks" panel shell + form controls (`useTweaks`, `TweakSlider`, etc.). Host-protocol driven. |
| `PlanDiagram.jsx` | The interactive to-scale **top-down** SVG plan. Drag/click-to-place, snapping, trusses/columns, dimension chains. The most complex file. |
| `Elevation.jsx` | Read-only to-scale **side/front elevation** SVG (openings at true heights, roof pitch, columns). |
| `Schedule.jsx` | The opening schedule table (tag, type, size, wall, position, notes). |
| `Editor.jsx` | Left rail: building size, doc info, finishes/color, config, framing, opening list + per-opening editor, saved layouts. |
| `Sheet.jsx` | Composes the client approval document from header + spec band + plan + elevation + schedule + sign-off. |
| `app.jsx` | Root: state, mode switching, keyboard, save/load, print sizing, tweaks wiring. Renders into `#root`. |
| `styles.css` | All styling. Imports the design-system tokens from `assets/colors_and_type.css`. |

### Recommended production module boundaries
Keep the same split. Convert `window`-attached exports to real ES module `export`s and
imports. `data.js` becomes a pure TS module (great place for unit tests — see Testing).

## Data Model

### Building (the working config)
```
{
  width, length, height,     // decimal FEET
  wind,                      // mph, default 150
  pitch,                     // string "3:12"
  config,                    // 'enclosed' | 'hybrid' | 'carport'
  openLength,                // ft of the open (carport) portion, hybrid only
  openEnd,                   // 'front' | 'back' — which gable end is open
  gableSheet,                // 'open' | 'gable' (carport gable peak sheeted or open)
  trussOC,                   // 4 | 5 | 2  (feet on-center)
  gauge,                     // '14' | '12'
  legType,                   // 'single' | 'double' | 'ladder'
}
```

### Opening
```
{
  id,                        // unique
  type,                      // key into OPENING_TYPES
  wall,                      // 'front'|'back'|'left'|'right'|'divider'
  offset,                    // decimal FEET from the wall's reference corner
  w, h,                      // decimal FEET
  sill,                      // decimal FEET off floor (windows)
  name,                      // custom label (custom/framed)
  note,                      // free text
}
```

### docInfo
```
{ customer, address, quoteNo, rep, date,   // all default EMPTY (no pre-fill)
  mfr,                                       // 'ca' | 'cci' — INTERNAL ONLY
  finishes: { roof, walls, trim, hasWainscot, wainscot } }
```

**Units:** everything is stored in **decimal feet**. Display uses `ftIn()` / `ftInTight()`
(→ `8′ 11″` / `8′11″`). Input parsing uses `parseFeet()` (see below).

## Key Business Rules (in `data.js` — replicate exactly)

**Truss spacing (on-center):**
- Building **> 24′ wide → 4′ OC** standard (never 5′). Upgrade option: **2′**.
- Building **≤ 24′ wide → 5′ OC** standard, with upgrade to **4′**, and **2′**.
- `baseTrussOC(width)`, `trussOptions(width)`, `normalizeTrussOC(width, current)`.

**Framing gauge:** `14` (standard) or `12` (heavy-duty upgrade). Tube is **2″ × 2″** for
both — the gauge is wall thickness, not outside dimension.

**Column / leg type** (`baseLegType(width, height)`, weakest→strongest, upgrade-only):
- Height ≤ 12′ → **single**; 13′–16′ → **double**; 17′+ → **ladder**.
- **Any building ≥ 32′ wide is forced to ladder**, regardless of height.
- `legOptions()` returns base + anything stronger; UI shows an "AUTO" lock when forced.

**Config / hybrid carport:** a hybrid building has an enclosed portion + an open carport
portion sharing one roofline, split by an **Additional End Wall** (`wall: 'divider'`).
`openLength` is the carport length; `openEnd` which gable is open; `gableSheet` whether the
open gable's peak triangle is sheeted. Trusses continue across the whole length; columns
appear at the divider. User-placed sidewall openings are **not** auto-moved when the
enclosed length changes — only the divider/front wall openings adjust.

**Manufacturer catalogs (`COLOR_CATALOGS`)** — `ca` (label "CA") and `cci` (label "CCI").
Internal only: the manufacturer name/label must **never** appear on the client approval
sheet — only the chosen color names (+ CA order codes). Switching catalog runs
`migrateFinishes()` (exact key match → same display name → that catalog's default).

## Dimension Input Parsing — `parseFeet(raw)` (NEW)
Opening Width / Height / Sill accept flexible text; result stored as decimal feet:
- `8'11"` or `8' 11` or `8ft 11in` → 8 + 11/12 = 8.9167
- `23"` or `23in` → 23/12 = 1.9167
- `8.5` or `8.5'` or `8` (bare number, no marks) → **feet**
- unparseable → `null` (field shows an inline "Try 8'11\", 23\", or 8.5" error and does not commit)
Normalizes smart quotes (’ ” ′ ″) first. The `DimTextField` in `Editor.jsx` shows the tidy
`ftIn()` interpretation under the field while editing, commits on blur/Enter, cancels on Esc.

## Screens / Views

### 1. Edit mode
**Layout:** full-height flex. Top **toolbar** (brand wordmark left; sheet-style chips;
Edit / Approval Sheet segmented toggle; **Save PDF**; **Tweaks**). Below: left **rail**
(fixed ~360px, scrolls) + **canvas** (flex-1, dotted steel background) holding a sticky
**canvas-bar** (Frames toggle, Elevation toggle + wall chips, live tip) over the scaled sheet.

**Rail sections (top→bottom):** Layout Builder heading · Building (Width/Length/Eave +
Wind/Pitch) · Document Info (all empty by default) · Finishes & Color (internal Catalog
CA/CCI selector with lock badge, Roof/Walls/Trim pickers, Add wainscot) · Configuration
(enclosed/hybrid/carport; hybrid adds enclosed/carport split + open end + gable sheeting) ·
Framing & Structure (Truss spacing / Gauge / Column type segmented controls with auto notes) ·
Quick Add · Add Opening (type palette → click plan to place) · Placed openings list
(expandable rows → per-opening editor) · Saved Layouts.

**Per-opening editor:** Type + Wall selects · **Width / Height** (`DimTextField`) ·
From-near / From-far corner (both editable, mirror each other) · spacing helper (distance to
both corners + gaps to neighbor openings, or overflow warning) · Sill (windows) · Product
label (custom/framed) · Note · Duplicate / Remove.

### 2. Approval Sheet (client document / print target)
Dark masthead (STORMSAFE STEEL wordmark + "Building Approval Sheet" + MPH rated seal) ·
customer/site/quote/rep info strip (cells only render when filled) · **compact dark spec
band** (Width · Length · Eave · Wind · Pitch · Trusses · Framing · Columns) · config strip
(hybrid/carport only) · Finishes strip (swatch + name per slot) · **Opening Plan** (large,
dominant) · optional Elevation · Opening Schedule table · sign-off block (acknowledgement +
signature/date lines). **No footer, no manufacturer name.**

## Interactions & Behavior

**Plan (PlanDiagram):**
- Auto-orients so the **longer** building dimension runs horizontally (fills the wide page).
- **Drag** an opening along any wall; rounds to **1″** increments.
- **Click-to-place**: arm a type in the rail, a ghost follows the cursor, click a wall to drop.
- **Snapping** to edges, wall center, 5′ grid, and neighbor openings. Snap zone ~3.5px.
  **Trusses snap the opening CENTER only, at half range** (so wide doors aren't trapped between
  4′-OC trusses). **Hold Alt/Option** while dragging or placing to bypass all snapping.
  Alignment guide + a live measurement pill show during drag.
- Trusses drawn as bold dashed lines edge-to-edge; columns as bold caps on eave walls,
  glyph varies by leg type (single/double/ladder).
- **Keyboard** (selected opening): arrows nudge **1″**, **Shift** = 6″, **⌘/Ctrl** = 1′;
  **Delete/Backspace** removes; **Esc** cancels placement / deselects.

**Motion (design-system rule — no bounce/overshoot):** entrances `--ease-out`, state changes
`--ease-in-out`; 120/200/320ms only. Press = 96% scale. Respect `prefers-reduced-motion`.

**Persistence:** working state autosaves to `localStorage` (`stormsafe.current.v2`); named
layouts under `stormsafe.layouts.v2`. Restore on load. In production, replace with the app's
persistence/api layer but keep the autosave + named-save/load UX.

**Print:** `beforeprint` scales `.sheet` via CSS `zoom` to fit one Letter page; `afterprint`
resets. `@page { size: letter portrait; margin: 0 }`. Save PDF switches to Sheet mode first.

## State Management
Root state in `app.jsx`: `t` (tweak/building values via `useTweaks`), `mode`, `openings[]`,
`selectedId`, `placeType`, `docInfo`, `savedLayouts[]`, `tweaksOpen`. Tag numbers for openings
are derived (front→right→back→left→divider, then by offset). Port to the app's idiomatic state
(hooks/store); keep derived tag numbering pure.

## Design Tokens
Use the StormSafe design system tokens in `assets/colors_and_type.css` (imported by
`styles.css`) — **do not hardcode hex**. Core: navy `--navy-900 #0B1F3A`; steel gray scale
`--steel-50…950`; accent teal `--teal-500 #14A6A0` (sparingly); alert `--storm-500 #E84A1F`;
safe green `--safe-500`. Type: Oswald (display, uppercase), Barlow (body), JetBrains Mono
(dimensions/specs). Radii 4px / pill only. Motion ≤320ms, no bounce. Full guidance in the
design-system README.

## Assets (in `assets/`)
- `logo-emblem.png` — steel seal (used as the MPH-rated badge on the sheet).
- `logo-lockup.svg`, `logo-mark.svg` — wordmark/mark.
- `pattern-diamond.svg`, `pattern-corrugated.svg` — low-opacity industrial textures.
- `colors_and_type.css` — **design tokens** (source of truth).
- `hero-placeholder.svg` — unused here.
All plan/elevation graphics are generated SVG (no raster assets needed).

## Testing (recommended)
`data.js` is pure and highly testable. Prioritize unit tests for: `parseFeet` (all formats +
junk), `baseTrussOC`/`trussOptions`/`normalizeTrussOC`, `baseLegType`/`legOptions`/`normalizeLegType`,
`migrateFinishes`, and `ftIn`/`ftInTight` round-trips.

## Files
All prototype source is in this folder: `index.html`, `app.jsx`, `data.js`, `Editor.jsx`,
`PlanDiagram.jsx`, `Elevation.jsx`, `Schedule.jsx`, `Sheet.jsx`, `tweaks-panel.jsx`,
`styles.css`, and `assets/`. Open `index.html` in a browser to run the reference prototype.
