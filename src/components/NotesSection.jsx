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

export default function NotesSection({ clientId }) {
  const { users } = useUsers()
  const { user } = useAuth()
  const [notes, setNotes] = useState([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState({ category: 'general', body: '' })
  const [editId, setEditId] = useState(null)
  const [editBody, setEditBody] = useState('')

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

  return (
    <div className="detail-card detail-card-full notes-card" style={{ marginTop: 16 }}>
      <div className="notes-head">
        <div className="detail-card-title" style={{ margin: 0 }}>Notes</div>
        <button type="button" className="link-btn" onClick={() => setAdding(a => !a)}>{adding ? 'Close' : '+ Add Note'}</button>
      </div>

      {adding && (
        <div className="note-compose">
          <div className="seg note-cat-seg">
            {CATS.map(c => (
              <button key={c.v} type="button" className={draft.category === c.v ? 'on' : ''} onClick={() => setDraft(d => ({ ...d, category: c.v }))}>{c.l}</button>
            ))}
          </div>
          <textarea rows={3} value={draft.body} onChange={e => setDraft(d => ({ ...d, body: e.target.value }))} placeholder="Jot a note for you and the team…" />
          <div className="note-compose-actions">
            <button type="button" className="btn-secondary" onClick={() => { setAdding(false); setDraft({ category: 'general', body: '' }) }}>Cancel</button>
            <button type="button" className="btn-primary" onClick={addNote} disabled={!draft.body.trim()}>Save Note</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="muted" style={{ padding: '10px 0' }}>Loading…</div>
      ) : notes.length === 0 ? (
        <div className="empty-state" style={{ padding: '14px 0' }}>No notes yet — add one for you and Josh.</div>
      ) : (
        <div className="notes-grid">
          {notes.map(n => {
            const m = catMeta(n.category)
            return (
              <div key={n.id} className="note-card">
                <div className="note-card-head">
                  <span className={`note-badge note-${n.category}`}>{m.icon} {m.l}</span>
                  <div className="note-card-actions">
                    {editId !== n.id && <button type="button" className="link-btn" onClick={() => { setEditId(n.id); setEditBody(n.body) }}>Edit</button>}
                    <button type="button" className="link-btn link-btn-danger" onClick={() => del(n.id)}>Delete</button>
                  </div>
                </div>
                {editId === n.id ? (
                  <div className="note-edit">
                    <textarea rows={3} value={editBody} onChange={e => setEditBody(e.target.value)} />
                    <div className="note-compose-actions">
                      <button type="button" className="btn-secondary" onClick={() => setEditId(null)}>Cancel</button>
                      <button type="button" className="btn-primary" onClick={() => saveEdit(n.id)}>Save</button>
                    </div>
                  </div>
                ) : (
                  <div className="note-body">{n.body}</div>
                )}
                <div className="note-meta">{userLabel(users, n.created_by)} · {new Date(n.created_at).toLocaleDateString()}{n.updated_at ? ' · edited' : ''}</div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
