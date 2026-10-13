// Quote PDF style (owner 10/12/26: White = print-friendly, Dark = on-screen, default Dark).
// The CRM bar and the embedded program share one choice; the saved quote PDF is the
// program's printQuote, so it follows that choice. Run: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { QUOTE_STYLE_KEY, QUOTE_STYLES, normalizeQuoteStyle, readQuoteStyle, writeQuoteStyle } from '../src/lib/quoteStyle.js'

const mem = (init = {}) => {
  const m = new Map(Object.entries(init))
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)) }, m }
}

test('defaults to Dark; only "white" turns White on', () => {
  assert.equal(readQuoteStyle(mem()), 'dark')
  assert.equal(readQuoteStyle(mem({ [QUOTE_STYLE_KEY]: 'white' })), 'white')
  assert.equal(readQuoteStyle(mem({ [QUOTE_STYLE_KEY]: 'WHITE' })), 'dark')
  assert.equal(readQuoteStyle(mem({ [QUOTE_STYLE_KEY]: 'light' })), 'dark')
  assert.equal(readQuoteStyle(null), 'dark')
  const throwing = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') } }
  assert.equal(readQuoteStyle(throwing), 'dark')
  assert.equal(normalizeQuoteStyle(undefined), 'dark')
})

test('the two options are named as the owner asked', () => {
  assert.deepEqual(QUOTE_STYLES.map((o) => [o.value, o.label]), [['dark', 'Dark (on-screen)'], ['white', 'White (print-friendly)']])
})

test('a choice is remembered and handed to the program', () => {
  const s = mem()
  const calls = []
  const program = { setQuoteStyle: (v) => calls.push(v) }
  assert.equal(writeQuoteStyle('white', { storage: s, program }), 'white')
  assert.equal(s.m.get(QUOTE_STYLE_KEY), 'white')
  assert.equal(readQuoteStyle(s), 'white')
  assert.equal(writeQuoteStyle('anything', { storage: s, program }), 'dark')
  assert.deepEqual(calls, ['white', 'dark'])
  // no program loaded yet / an older program without the control / blocked storage: never throws
  assert.equal(writeQuoteStyle('white', { storage: s, program: null }), 'white')
  assert.equal(writeQuoteStyle('white', { storage: s, program: {} }), 'white')
  assert.equal(writeQuoteStyle('white', { storage: { setItem() { throw new Error('quota') } }, program }), 'white')
})

test('the CRM and its embedded program use the same key and setter', () => {
  const prog = readFileSync(new URL('../public/build/quote-builder.html', import.meta.url), 'utf8')
  assert.match(prog, new RegExp(`var QSTYLE_KEY='${QUOTE_STYLE_KEY}';`))
  assert.match(prog, /function setQuoteStyle\(v\)\{/)
  // printQuote (what capturePrintHtml saves) reads the style and recolours only when White
  assert.match(prog, /var qWhite = \(quoteStyle\(\) === 'white'\);/)
  assert.match(prog, /if\(qWhite\) fullDoc = quoteWhiteDoc\(fullDoc\);/)
})

// ── 10/12 verification fixes ──
test('a narrower window shows one word per option; the tooltip keeps the full wording', () => {
  assert.deepEqual(QUOTE_STYLES.map((o) => o.short), ['Dark', 'White'])
  for (const o of QUOTE_STYLES) assert.ok(o.title.startsWith(o.label + ':'), o.title)
  const jsx = readFileSync(new URL('../src/components/QuoteStyleToggle.jsx', import.meta.url), 'utf8')
  assert.match(jsx, /<span className="qb-style-long">\{o\.label\}<\/span>\s*<span className="qb-style-short">\{o\.short\}<\/span>/)
  assert.match(jsx, /title=\{o\.title\}/)
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
  assert.match(css, /\.qb-style-short \{ display: none; \}/)
  assert.match(css, /@media \(max-width: 1440px\) \{\s*\.qb-style-long \{ display: none; \}\s*\.qb-style-short \{ display: inline; \}\s*\}/)
  // the bar's buttons keep their labels on one line (packaged CRM down to 1024px); the title gives way first
  assert.match(css, /\.qb-bar-actions \{ flex: none; align-items: center; \}/)
  assert.match(css, /\.qb-bar-actions > \.btn-primary, \.qb-bar-actions > \.btn-secondary \{ white-space: nowrap; \}/)
  assert.match(css, /\.qb-bar-title \{ min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; \}/)
  const modal = readFileSync(new URL('../src/components/BuildQuoteModal.jsx', import.meta.url), 'utf8')
  assert.match(modal, /<div className="qb-bar-title" title=\{barClient \? `\$\{barTitle\} · \$\{barClient\}` : barTitle\}>/)
})

test('the embedded program carries the White fixes, with the 3D bundle that takes light pictures', () => {
  const prog = readFileSync(new URL('../public/build/quote-builder.html', import.meta.url), 'utf8')
  // a 3D view that ignores {theme:'light'} (older bundle) -> the 2D drawings, never dark pictures on a White quote
  assert.match(prog, /if\(qWhite && imgs3D && imgs3D\.theme !== 'light'\)\{[^\n]*imgs3D = null; \}/)
  // 2D elevations drawn for a white page; spacing-page outlines darkened; band / panel pairs
  assert.match(prog, /: _qwDrawing\(qWhite, buildingPageHTML\)\)/)
  assert.match(prog, /var QW_STROKE=_qwKeys\(\[/)
  assert.match(prog, /\['#1C2E3F','#e3ebf0','band'\]/)
  // the mobile action bar's room rule (the old one never applied)
  assert.match(prog, /\.main>\.left\{padding-bottom:var\(--mab-room,118px\)\}/)
  for (const page of ['build.html', 'index.html']) {
    const h = readFileSync(new URL('../public/build/' + page, import.meta.url), 'utf8')
    const m = /src="\.\/assets\/(main-[A-Za-z0-9_-]+\.js)"/.exec(h)
    assert.ok(m, page)
    const bundle = readFileSync(new URL('../public/build/assets/' + m[1], import.meta.url), 'utf8')
    assert.match(bundle, /lightCaptureHide/)
    assert.match(bundle, /\.theme="light"/) // the capture says its pictures are light
    assert.match(bundle, /#6b7785/) // the silhouette outline (a white building on the light background)
  }
})
