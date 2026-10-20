// Inquiry date of a lead (owner 10/20/26: the Leads page "doesn't list the inquiry date - I should be seeing that
// as well as being able to organize the leads by date").
//
// A lead's inquiry date = its First Contact Date (the date column a rep or the website sets), else the day it
// was added (created_at, New York day) - the same rule the Performance page counts leads by (perfStats.js), so
// the two screens always agree. Plain dates are never run through new Date() (that would shift them a day).
import { daysBetween, nyDay, plainDay } from './perfStats.js'

/** { day: 'YYYY-MM-DD' | null, from: 'first_contact' | 'added' | null } */
export function inquiryOf(c) {
  const own = plainDay(c?.first_contact_date)
  if (own) return { day: own, from: 'first_contact' }
  const added = nyDay(c?.created_at)
  return added ? { day: added, from: 'added' } : { day: null, from: null }
}

/** '2026-10-20' -> '10/20/2026' ('' when there is no day). */
export function fmtDay(day) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day || '')
  return m ? `${m[2]}/${m[3]}/${m[1]}` : ''
}

/** 'today' / '1 day ago' / '12 days ago' / 'in 2 days' (a first-contact date set ahead) - '' when unknown. */
export function ageText(day, today = nyDay(new Date())) {
  if (!day || !today) return ''
  const n = daysBetween(day, today)
  if (n === 0) return 'today'
  if (n === 1) return '1 day ago'
  if (n > 1) return `${n} days ago`
  return n === -1 ? 'in 1 day' : `in ${-n} days`
}

/**
 * Sort comparator: newest inquiry first ('desc') or oldest first ('asc'). A lead with no readable date sinks to
 * the bottom either way; equal days fall back to when the lead was added (newest first for 'desc').
 */
export function compareInquiry(a, b, dir = 'desc') {
  const da = inquiryOf(a).day, db = inquiryOf(b).day
  if (!da && !db) return 0
  if (!da) return 1
  if (!db) return -1
  if (da !== db) return dir === 'asc' ? da.localeCompare(db) : db.localeCompare(da)
  const ca = String(a?.created_at ?? ''), cb = String(b?.created_at ?? '')
  return dir === 'asc' ? ca.localeCompare(cb) : cb.localeCompare(ca)
}
