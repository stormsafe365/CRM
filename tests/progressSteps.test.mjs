// Owner 11/16/26 (Steve Coldwell): set back to New Lead after a quote was made, but the stepper still showed "Quote Sent"
// and "Lead Created" could not be clicked. The stepper now follows the stage that is set; "Lead Created" sets New Lead.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reachedRank, buildMilestones, STEP_PATCH, STEP_LABELS } from '../src/lib/progressSteps.js'

const done = (c) => buildMilestones(c).filter((m) => m.done).map((m) => m.label)

test('a New Lead shows only "Lead Created" ticked - a saved quote does not tick "Quote Sent" any more', () => {
  assert.equal(reachedRank({ status: 'new_lead' }), 0)
  assert.deepEqual(done({ status: 'new_lead' }), ['Lead Created'])
})

test('the other stages read as before', () => {
  assert.deepEqual(done({ status: 'contacted' }), ['Lead Created', 'Attempting to Contact'])
  assert.equal(reachedRank({ status: 'working' }), 2)
  assert.equal(reachedRank({ status: 'working_hot' }), 2)
  assert.equal(reachedRank({ status: 'contract_sent' }), 3)
  assert.equal(reachedRank({ status: 'ordered' }), 4)
  assert.equal(reachedRank({ status: 'ordered', payment_cleared: true }), 5)
  assert.equal(reachedRank({ status: 'ordered', project_stage: 'installed' }), 9)
  assert.equal(reachedRank({ status: 'something_old' }), 1)
})

test('clicking "Lead Created" sets the lead back to New Lead / Cold; the other clicks are unchanged', () => {
  assert.equal(STEP_LABELS[0], 'Lead Created')
  assert.deepEqual(STEP_PATCH[0], { status: 'new_lead', lead_temperature: 'cold' })
  assert.deepEqual(STEP_PATCH[2], { status: 'working', lead_temperature: 'working' })
  assert.equal(STEP_PATCH.length, STEP_LABELS.length)
  // every click lands on its own step
  STEP_PATCH.forEach((p, i) => { if (i !== 5 && i < 6) assert.equal(reachedRank(p), i) })
})

test('owner 11/19/26: "Contract Signed" never opens the Mark-as-Ordered box - Deposit Received does', async () => {
  const { stepOpensOrderBox } = await import('../src/lib/progressSteps.js')
  const signedNoOrder = { status: 'contract_sent', order_date: null }
  assert.equal(stepOpensOrderBox(4, signedNoOrder), false) // Contract Signed: waiting on the deposit
  assert.equal(stepOpensOrderBox(5, signedNoOrder), true) // Deposit Received
  assert.equal(stepOpensOrderBox(5, { order_date: '2026-11-19' }), true) // always (edit the order details)
  assert.equal(stepOpensOrderBox(6, signedNoOrder), true) // Engineering with no order saved yet
  assert.equal(stepOpensOrderBox(6, { order_date: '2026-11-19' }), false)
  for (const i of [0, 1, 2, 3]) assert.equal(stepOpensOrderBox(i, signedNoOrder), false)
  // wired in: the stepper asks it; the temperature bar and the payment switch follow the same rule
  const { readFileSync } = await import('node:fs')
  const ap = readFileSync(new URL('../src/components/ActivityProgress.jsx', import.meta.url), 'utf8')
  assert.match(ap, /if \(onMarkOrdered && stepOpensOrderBox\(i, client\)\) \{/)
  const cd = readFileSync(new URL('../src/pages/ClientDetail.jsx', import.meta.url), 'utf8')
  assert.doesNotMatch(cd, /if \(mapped === 'ordered' && !client\.order_date\) setOrdering\(true\)/)
  assert.match(cd, /if \(next && !client\.order_date && onNeedOrder\) \{ onNeedOrder\(\); return \}/)
})
