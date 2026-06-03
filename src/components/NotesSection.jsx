// NotesSection: a private team scratchpad on each lead — notes you and Josh
// jot after a call or for yourselves. Separate from the activity log and
// follow-ups. Categorized (Call / Project / Permit / General), with add, edit,
// and delete. Lives at the bottom of the lead page under the Document Hub.

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useUsers, userLabel } from '../lib/useUsers'
import { useAuth } from '../context/AuthContext'

const CATS = [
  { v: 'call', l: 'Call Note', icon: '📞' },
  { v: 'project', l: 'Project Note', icon: '🏗️' },
  { v: 'permit', l: 'Permit Note', icon: '📋' },
  { v: 'general', l: 'General Note', icon: '📝' },
]
const catMeta = (v) => CATS.find(c => c.v === v) || CATS[3]

const nic = (paths) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{paths}</svg>
const NOTE_SVG = {
  call: nic(<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />),
  project: nic(<><path d="M3 21h18" /><path d="M5 21V7l8-4v18" /><path d="M19 21V11l-6-4" /></>),
  permit: nic(<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />),
  general: nic(<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M9 13h6M9 17h4" /></>),
}
const NOTE_TABS = [{ v: 'all', l: 'All Notes' }, ...CATS.map(c => ({ v: c.v, l: c.l.replace(' Note', '') }))]

export default function NotesSection({ clientId }) {
  const { users } = useUsers()
  const { user } = useAuth()
  const [notes, setNotes] = useState([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState({ category: 'general', body: '' })
  const [editId, setEditId] = useState(null)
  const [editBody, setEditBody] = useState('')
  const [tab, setTab] = useState('all')

  async function load() {
    const { data } = await supabase
      .from('client_notes')
      .select('*')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
    setNotes(data ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
    const ch = supabase
      .channel(`notes-${clientId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'client_notes', filter: `client_id=eq.${clientId}` }, () => load())
      .subscribe()
    return () => supabase.removeChannel(ch)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId])

  async function addNote() {
    if (!draft.body.trim()) return
    await supabase.from('client_notes').insert({
      client_id: clientId, category: draft.category, body: draft.body.trim(), created_by: user?.id ?? null,
    })
    setDraft({ category: 'general', body: '' })
    setAdding(false)
  }
  async function saveEdit(id) {
    if (!editBody.trim()) return
    await supabase.from('client_notes').update({ body: editBody.trim(), updated_at: new Date().toISOString() }).eq('id', id)
    setEditId(null)
  }
  async function del(id) {
    await supabase.from('client_notes').delete().eq('id', id)
  }

  const shown = tab === 'all' ? notes : notes.filter(n => n.category === tab)

  return (
    <section className="card card-pad notes-card">
      <div className="notes-head">
        <h3 style={{ margin: 0, fontFamily: 'var(--font-head)', fontSize: 13, fontWeight: 400, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--fg)', display: 'flex', alignItems: 'center', gap: 11 }}>
          <span style={{ width: 16, height: 3, borderRadius: 2, background: 'var(--lime)', boxShadow: '0 0 10px rgba(143,209,79,0.6)' }} />Notes
        </h3>
        <div className="notes-tabs">
          {NOTE_TABS.map(t => (
            <button key={t.v} className={`notes-tab${tab === t.v ? ' active' : ''}`} onClick={() => setTab(t.v)}>{t.l}</button>
          ))}
        </div>
        <div className="notes-tools">
          <button type="button" className="btn btn-primary" onClick={() => setAdding(a => !a)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>{adding ? 'Close' : 'Add Note'}
          </button>
        </div>
      </div>

      {adding && (
        <div className="note-compose" style={{ marginTop: 18 }}>
          <div className="seg">
            {CATS.map(c => (
              <button key={c.v} type="button" className={draft.category === c.v ? 'active' : ''} onClick={() => setDraft(d => ({ ...d, category: c.v }))}>{c.l.replace(' Note', '')}</button>
            ))}
          </div>
          <div className="field" style={{ marginTop: 12, marginBottom: 0 }}>
            <textarea rows={3} value={draft.body} onChange={e => setDraft(d => ({ ...d, body: e.target.value }))} placeholder="Jot a note for you and the team…" />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 12 }}>
            <button type="button" className="btn btn-ghost" onClick={() => { setAdding(false); setDraft({ category: 'general', body: '' }) }}>Cancel</button>
            <button type="button" className="btn btn-primary" onClick={addNote} disabled={!draft.body.trim()}>Save Note</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="muted" style={{ padding: '16px 0' }}>Loading…</div>
      ) : shown.length === 0 ? (
        <div className="empty-state" style={{ padding: '16px 0' }}>{notes.length === 0 ? 'No notes yet — add one for you and Josh.' : 'No notes in this category.'}</div>
      ) : (
        <div className="notes-grid">
          {shown.map(n => {
            const m = catMeta(n.category)
            return (
              <div key={n.id} className={`note ${n.category}`}>
                <div className="note-top">
                  <div className="note-ic">{NOTE_SVG[n.category] || NOTE_SVG.general}</div>
                  <div className="note-meta">
                    <div className="nt">{m.l}</div>
                    <div className="sub">{userLabel(users, n.created_by)} · {new Date(n.created_at).toLocaleDateString()}{n.updated_at ? ' · edited' : ''}</div>
                  </div>
                  {editId !== n.id && (
                    <div style={{ display: 'flex', gap: 10, flex: '0 0 auto' }}>
                      <span className="link-cyan" role="button" onClick={() => { setEditId(n.id); setEditBody(n.body) }}>Edit</span>
                      <span className="link-cyan" role="button" style={{ color: 'var(--danger)' }} onClick={() => del(n.id)}>Delete</span>
                    </div>
                  )}
                </div>
                {editId === n.id ? (
                  <div className="note-edit">
                    <div className="field" style={{ marginBottom: 0 }}><textarea rows={3} value={editBody} onChange={e => setEditBody(e.target.value)} /></div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
                      <button type="button" className="btn btn-ghost" onClick={() => setEditId(null)}>Cancel</button>
                      <button type="button" className="btn btn-primary" onClick={() => saveEdit(n.id)}>Save</button>
                    </div>
                  </div>
                ) : (
                  <div className="note-body">{n.body}</div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
