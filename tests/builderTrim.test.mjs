// The summary's buttons inside the CRM (owner 11/2/26): Save / Print PDF, Generate Contract, Use as Revision only. Run: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { HIDE_IN_CRM, trimProgramButtons } from '../src/lib/builderTrim.js'

const btn = (text) => ({ textContent: text, style: {}, dataset: {} })
const docOf = (list) => ({ querySelectorAll: (sel) => (sel === '.desktop-btns button' ? list : []) })

test('hides Executed Copy, Reset Form, Revised Layout and Send Design Link; keeps the other three', () => {
  const list = ['SAVE / PRINT PDF', 'GENERATE CONTRACT', 'EXECUTED COPY — DEPOSIT PAID', 'RESET FORM', 'USE AS REVISION', 'REVISED LAYOUT', 'SEND DESIGN LINK'].map(btn)
  assert.equal(trimProgramButtons(docOf(list)), 4)
  assert.deepEqual(list.filter((b) => b.style.display !== 'none').map((b) => b.textContent), ['SAVE / PRINT PDF', 'GENERATE CONTRACT', 'USE AS REVISION'])
  assert.equal(trimProgramButtons(docOf(list)), 0) // already done
  assert.equal(trimProgramButtons(null), 0)
})

test('the program still has those four buttons with those words (so the CRM can find them)', () => {
  const prog = readFileSync(new URL('../public/build/quote-builder.html', import.meta.url), 'utf8')
  const row = prog.slice(prog.indexOf('<div style="margin-top:10px" class="desktop-btns">'), prog.indexOf('</div>', prog.indexOf('<div style="margin-top:10px" class="desktop-btns">')))
  for (const w of HIDE_IN_CRM) assert.match(row, new RegExp('>' + w), w)
  for (const w of ['SAVE / PRINT PDF', 'GENERATE CONTRACT', 'USE AS REVISION']) assert.match(row, new RegExp('>' + w.replace(/\//g, '\/')), w)
})

test('Executed Copy stays on the quote card (Documents menu); the card link button is an icon with a name', () => {
  for (const f of ['../src/components/QuoteDeck.jsx', '../src/components/QuotesTab.jsx']) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8')
    assert.match(src, /\{ id: 'exec', label: 'Executed Copy — Deposit Paid'/)
    assert.match(src, /className="[^"]*qcard-link" [^>]*aria-label="Create design link"/)
    assert.doesNotMatch(src, />Create link</)
  }
})
