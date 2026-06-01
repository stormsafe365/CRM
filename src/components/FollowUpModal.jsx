// FollowUpModal: create or edit a single follow-up. Used by the Upcoming
// Follow-Ups card. Editing prefills every field, so adjusting a time (3pm → 5pm)
// or anything else is a couple clicks. Saving writes to the follow_ups table;
// the DB trigger re-points clients.follow_up_date at the soonest pending one.

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'
import { useUsers } from '../lib/useUsers'
import { useAuth } from '../context/AuthContext'
import { isoToday } from '../lib/followups'

const AUDIENCES = [{ v: 'client', l: 'Client' }, { v: 'rep', l: 'Rep' }, { v: 'manufacturer', l: 'Manufacturer' }]
const TYPES = [{ v: 'call', l: 'Call' }, { v: 'text', l: 'Text' }, { v: 'email', l: 'Email' }, { v: 'note', l: 'Note' }]
const TEMPLATES = ['Check on quote', 'Financing options', 'Follow up after permit', 'Schedule install', 'Touch base', 'Send revised quote']

export default function FollowUpModal({ clientId, followUp, onClose, onSaved }) {
  const { users } = useUsers()
  const { user } = useAuth()
  const editing = !!followUp
  const [f, setF] = useState({
    audience: followUp?.audience || 'client',
    type: followUp?.type || 'call',
    purpose: followUp?.purpose || '',
    details: followUp?.details || '',
    assigned_to: followUp?.assigned_to || user?.id || '',
    due_date: followUp?.due_date || isoToday(),
    due_time: followUp?.due_time ? followUp.due_time.slice(0, 5) : '',
    remind_crm: followUp?.remind_crm ?? true,
    remind_email: followUp?.remind_email ?? false,
    remind_sms: followUp?.remind_sms ?? false,
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const up = (k, v) => setF(s => ({ ...s, [k]: v }))

  async function save() {
    if (!f.due_date) { setErr('Pick a date.'); return }
    setSaving(true); setErr('')
    const row = {
      client_id: clientId,
      audience: f.audience,
      type: f.type,
      purpose: f.purpose.trim() || null,
      details: f.details.trim() || null,
      assigned_to: f.assigned_to || null,
      due_date: f.due_date,
      due_time: f.due_time || null,
      remind_crm: f.remind_crm,
      remind_email: f.remind_email,
      remind_sms: f.remind_sms,
    }
    const { error } = editing
      ? await supabase.from('follow_ups').update(row).eq('id', followUp.id)
      : await supabase.from('follow_ups').insert({ ...row, created_by: user?.id ?? null })
    setSaving(false)
    if (error) { setErr(error.message); return }
    onSaved?.(); onClose()
  }

  async function remove() {
    setSaving(true)
    const { error } = await supabase.from('follow_ups').delete().eq('id', followUp.id)
    setSaving(false)
    if (error) { setErr(error.message); return }
    onSaved?.(); onClose()
  }

  async function markCompleted() {
    setSaving(true)
    const { error } = await supabase.from('follow_ups').update({ status: 'done' }).eq('id', followUp.id)
    setSaving(false)
    if (error) { setErr(error.message); return }
    onSaved?.(); onClose()
  }

  return createPortal(
    <div className="fum-overlay" role="dialog" aria-modal="true" aria-label="Follow-up" onClick={onClose}>
      <div className="fum" onClick={e => e.stopPropagation()}>
        <div className="fum-head">
          <h3>{editing ? 'Edit Follow-Up' : 'New Follow-Up'}</h3>
          <button className="fum-x" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="fum-body">
          <div className="fum-field">
            <span className="fum-label">Assign To</span>
            <div className="seg fum-seg">
              {AUDIENCES.map(a => (
                <button key={a.v} type="button" className={f.audience === a.v ? 'on' : ''} onClick={() => up('audience', a.v)}>{a.l}</button>
              ))}
            </div>
          </div>

          <div className="fum-field">
            <span className="fum-label">Type</span>
            <div className="seg fum-seg">
              {TYPES.map(t => (
                <button key={t.v} type="button" className={f.type === t.v ? 'on' : ''} onClick={() => up('type', t.v)}>{t.l}</button>
              ))}
            </div>
          </div>

          <label className="fum-field">
            <span className="fum-label">Purpose</span>
            <input list="fu-templates" value={f.purpose} onChange={e => up('purpose', e.target.value)} placeholder="Choose a template or type your own…" />
            <datalist id="fu-templates">{TEMPLATES.map(t => <option key={t} value={t} />)}</datalist>
          </label>

          <label className="fum-field">
            <span className="fum-label">Details</span>
            <textarea rows={2} value={f.details} onChange={e => up('details', e.target.value)} placeholder="Optional notes" />
          </label>

          <label className="fum-field">
            <span className="fum-label">Assigned Rep</span>
            <select value={f.assigned_to} onChange={e => up('assigned_to', e.target.value)}>
              <option value="">— None —</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.display_name || u.email}</option>)}
            </select>
          </label>

          <div className="fum-row2">
            <label className="fum-field">
              <span className="fum-label">Date</span>
              <input type="date" value={f.due_date} onChange={e => up('due_date', e.target.value)} />
            </label>
            <label className="fum-field">
              <span className="fum-label">Time</span>
              <input type="time" value={f.due_time} onChange={e => up('due_time', e.target.value)} />
            </label>
          </div>

          <div className="fum-field">
            <span className="fum-label">Reminders</span>
            <div className="fum-reminders">
              <label><input type="checkbox" checked={f.remind_crm} onChange={e => up('remind_crm', e.target.checked)} /> CRM</label>
              <label><input type="checkbox" checked={f.remind_email} onChange={e => up('remind_email', e.target.checked)} /> Email</label>
              <label><input type="checkbox" checked={f.remind_sms} onChange={e => up('remind_sms', e.target.checked)} /> SMS</label>
            </div>
          </div>

          {err && <div className="fum-err">{err}</div>}
        </div>

        <div className="fum-foot">
          {editing && <button type="button" className="btn-danger-ghost" onClick={remove} disabled={saving}>Delete</button>}
          {editing && <button type="button" className="btn-secondary fum-complete" onClick={markCompleted} disabled={saving}>✓ Mark Completed</button>}
          <div style={{ flex: 1 }} />
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" className="btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save Follow-Up'}</button>
        </div>
      </div>
    </div>,
    document.body
  )
}
