// Rep vs admin view (owner 10/20/26): sidebar list, URL guard, and the calm rep dashboard model.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NAV_META, visibleNav, isRepBlocked, dashLayout, repHidesLink, designsPingTarget } from '../src/lib/repView.js'

const labels = (isAdmin) => visibleNav(NAV_META, isAdmin).map((i) => i.label)

test('rep sidebar keeps only Dashboard, Leads, Follow-Ups, 3D Builder', () => {
  assert.deepEqual(labels(false), ['Dashboard', 'Leads', 'Follow-Ups', '3D Builder'])
})

test('admin sidebar is every entry, unchanged', () => {
  assert.deepEqual(labels(true), [
    'Dashboard', 'Leads', 'Customer Designs', 'Projects', 'Follow-Ups', 'Follow-Up HQ', 'Pipeline',
    'Quotes', 'Document Hub', '3D Builder', '2D Layout', 'Performance', 'Trash',
  ])
})

test('while the role is unknown or errored nobody loses entries (Trash still needs a yes)', () => {
  for (const s of [null, 'error']) assert.equal(labels(s).length, NAV_META.length - 1)
})

test('URL guard: rep blocked from removed pages, never from in-lead flows; admin never blocked', () => {
  for (const p of ['/designs', '/projects', '/calendar', '/pipeline', '/quotes', '/documents', '/layout', '/performance', '/designs/x'])
    assert.equal(isRepBlocked(false, p), true, p)
  for (const p of ['/dashboard', '/clients', '/clients/new', '/clients/abc', '/followups', '/build'])
    assert.equal(isRepBlocked(false, p), false, p)
  for (const p of ['/pipeline', '/performance', '/quotes']) assert.equal(isRepBlocked(true, p), false)
  assert.equal(isRepBlocked(null, '/pipeline'), false)
})

test('rep dashboard layout: trimmed command center; admin layout unchanged', () => {
  const r = dashLayout(true), a = dashLayout(false)
  assert.equal(r.orderedLabel, 'Sold')
  assert.deepEqual(r.tools, ['QTE Builder'])
  assert.deepEqual(r.bottom, ['needsAttention'])
  assert.equal(r.quotesSent, false)
  assert.equal(r.analytics, false)
  assert.match(a.orderedLabel, /Ordered/)
  assert.deepEqual(a.tools, ['QTE Builder', '2D Layout'])
  assert.deepEqual(a.bottom, ['activeClients', 'projectStage', 'dueToday', 'needsAttention'])
  assert.equal(a.quotesSent && a.analytics, true)
})

test('no dead links for a rep: Follow-Up HQ / Customer Designs links hidden or repointed; admin and unknown roles keep them', () => {
  assert.equal(repHidesLink(false), true)
  for (const s of [true, null, 'error']) assert.equal(repHidesLink(s), false)
  // a design ping never opens a page the rep is redirected away from
  assert.equal(designsPingTarget(false), '/clients')
  assert.equal(isRepBlocked(false, designsPingTarget(false)), false)
  for (const s of [true, null, 'error']) assert.equal(designsPingTarget(s), '/designs')
})
