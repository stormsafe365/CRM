// Closing the builder (owner 11/2/26): the X asks "Continue without saving?" only when something would be lost;
// Done ▾ › Close without saving always asks "Are you sure?". Run: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { closeAsk } from '../src/lib/closeAsk.js'

const dirtyBuild = { dirty: true, priceMoved: false, buildChanged: true, saved: { total: 15000 }, screen: { total: 15000 } }
const dirtyPrice = { dirty: true, priceMoved: true, buildChanged: true, saved: { total: 15000 }, screen: { total: 16250.5 } }
const clean = { dirty: false, priceMoved: false, buildChanged: false, saved: { total: 15000 }, screen: { total: 15000 } }

test('X: nothing to lose closes at once', () => {
  assert.equal(closeAsk({ via: 'x', saved: true, quoteNumber: 'SS-2026-52471', check: clean }), null)
  assert.equal(closeAsk({ via: 'x', saved: true, check: null }), null) // could not be read (mid-save): as before
  assert.equal(closeAsk({ via: 'x', saved: false, hasBuild: false }), null) // a new quote with no building yet
})

test('X: a saved quote with changes asks "Continue without saving?" (Go back is the default)', () => {
  const a = closeAsk({ via: 'x', saved: true, quoteNumber: 'SS-2026-52471', check: dirtyBuild })
  assert.equal(a.title, 'Continue without saving?')
  assert.equal(a.okLabel, 'Close without saving')
  assert.equal(a.cancelLabel, 'Go back')
  assert.equal(a.changed, true)
  assert.equal(a.confirm, true)
  assert.deepEqual(a.lines, [])
  assert.equal(a.notes[0], 'The build on screen has changes that are not in quote #SS-2026-52471.')
  assert.match(a.notes[1], /Done ▾ › Update this quote or Save as a new quote/)
  const p = closeAsk({ via: 'x', saved: true, quoteNumber: 'SS-2026-52471', check: dirtyPrice })
  assert.match(p.notes[0], /^The price on screen is \$16,250\.50; quote #SS-2026-52471 is saved at \$15,000/)
})

test('X: a new quote with a building in it asks too (it would be lost)', () => {
  const a = closeAsk({ via: 'x', saved: false, hasBuild: true })
  assert.equal(a.title, 'Continue without saving?')
  assert.deepEqual(a.notes, ['This quote has not been saved to a lead yet.', 'Closing now loses this build. To keep it, go back and Save to Lead.'])
})

test('Done ▾ › Close without saving: always "Are you sure?"', () => {
  const d = closeAsk({ via: 'menu', saved: true, quoteNumber: 'SS-2026-52471', check: dirtyBuild })
  assert.equal(d.title, 'Are you sure?')
  assert.equal(d.changed, true)
  const c = closeAsk({ via: 'menu', saved: true, quoteNumber: 'SS-2026-52471', check: clean })
  assert.equal(c.title, 'Are you sure?')
  assert.equal(c.changed, false) // nothing to lose: Close is the default button
  assert.deepEqual(c.notes, ['Nothing has changed since quote #SS-2026-52471 was saved.'])
  assert.deepEqual(closeAsk({ via: 'menu', saved: true, check: null }).notes, ['Nothing has changed since this quote was saved.'])
})
