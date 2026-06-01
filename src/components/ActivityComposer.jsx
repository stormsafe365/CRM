// ActivityComposer: log a manual touch (note/call/email/meeting) and, in the
// SAME step, optionally set the next follow-up date. An audience toggle
// (Client / Factory) is stored in metadata so an order timeline can show both
// sides of the conversation. CRM-only — no pricing, no quote builder.

import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { MESSAGE_TEMPLATES } from '../lib/messageTemplates'
import FollowUpControls from './FollowUpControls'

const TYPES = [
  { v: 'call', label: 'Call' },
  { v: 'note', label: 'Note' },
  { v: 'email', label: 'Email' },
  { v: 'meeting', label: 'Meeting' },
]

export default function ActivityComposer({
  client,
  onLogged,
  defaultAudience = 'client',
  showAudience = false,
  compact = false,
}) {
  const { user } = useAuth()
  const [type, setType] = useState('call')
  const [audience, setAudience] = useState(defaultAudience)
  const [body, setBody] = useState('')
  const [nextDate, setNextDate] = useState(null)
  const [nextTime, setNextTime] = useState(null)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function submit(e) {
    e.preventDefault()
    if (!body.trim() && !nextDate) {
      setErr('Add a note or pick a follow-up date.')
      return
    }
    setSaving(true)
    setErr('')
    try {
      if (body.trim()) {
        const { error } = await supabase.from('activities').insert({
          client_id: client.id,
          type,
          body: body.trim(),
          metadata: { audience },
          created_by: user?.id ?? null,
        })
        if (error) throw error
      }
      if (nextDate) {
        // Updating clients.follow_up_date auto-logs a follow_up_set activity via
        // DB trigger — so we deliberately do NOT insert one here (no duplicates).
        const { error } = await supabase
          .from('clients')
          .update({ follow_up_date: nextDate, follow_up_time: nextTime })
          .eq('id', client.id)
        if (error) throw error
      }
      setBody('')
      setNextDate(null)
      setNextTime(null)
      onLogged?.({ nextDate })
    } catch (e2) {
      setErr(e2.message || 'Could not save.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className={`composer ${compact ? 'composer-compact' : ''}`} onSubmit={submit}>
      <div className="composer-row">
        <div className="chip-group">
          {TYPES.map(t => (
            <button
              key={t.v}
              type="button"
              className={`chip ${type === t.v ? 'on' : ''}`}
              onClick={() => setType(t.v)}
            >
              {t.label}
            </button>
          ))}
        </div>
        {showAudience && (
          <div className="chip-group">
            <button type="button" className={`chip ${audience === 'client' ? 'on' : ''}`} onClick={() => setAudience('client')}>
              ↔ Client
            </button>
            <button type="button" className={`chip ${audience === 'manufacturer' ? 'on' : ''}`} onClick={() => setAudience('manufacturer')}>
              Factory
            </button>
          </div>
        )}
      </div>

      <textarea
        className="composer-body"
        rows={compact ? 2 : 3}
        value={body}
        placeholder="What did you discuss? (optional — you can also just set the next date)"
        onChange={e => setBody(e.target.value)}
      />

      <div className="composer-row">
        <select
          className="filter-select composer-template"
          value=""
          onChange={e => {
            if (e.target.value !== '') setBody(MESSAGE_TEMPLATES[Number(e.target.value)].text)
          }}
        >
          <option value="">Insert a template…</option>
          {MESSAGE_TEMPLATES.map((t, i) => (
            <option key={i} value={i}>{t.label}</option>
          ))}
        </select>
      </div>

      <div className="composer-followup">
        <span className="composer-label">Next follow-up</span>
        <FollowUpControls
          baseDate={client.follow_up_date}
          coolingOff={!!client.cooling_off}
          selected={nextDate}
          selectedTime={nextTime}
          onPick={(d, t) => { setNextDate(d); setNextTime(t) }}
        />
      </div>

      {err && <div className="composer-err">{err}</div>}

      <div className="composer-actions">
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? 'Saving…' : 'Log touch'}
        </button>
      </div>
    </form>
  )
}
