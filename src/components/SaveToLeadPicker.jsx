// SaveToLeadPicker: the "save this build to a lead" dialog. Lets the rep attach
// the current 3D-builder quote to an EXISTING lead (searchable list) or create
// a NEW lead on the spot (prefilled from the builder's own Client Information
// section), then runs the shared harvest+save flow (lib/builderSave): totals +
// 3D thumb + branded PDF → the lead's Quotes + Document Hub.
//
// Used by the standalone 3D Builder tab (BuildTool) AND by BuildQuoteModal when
// the builder was opened without a lead (e.g. Dashboard → New Quote), so a walk-in
// call can be built first and saved to a brand-new lead after.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { isoToday } from '../lib/followups'
import { harvestAndSaveQuote } from '../lib/builderSave'
import { toast } from '../lib/uiFx'

const FIELD = {
  width: '100%', boxSizing: 'border-box',
  background: 'var(--inset, #0B1B32)', color: 'var(--fg, #e2e8f0)',
  border: '1px solid var(--line, #294059)', borderRadius: 8,
  padding: '9px 11px', fontSize: 13.5,
}
const LBL = { display: 'block', fontSize: 11.5, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--fg-3, #8598AC)', margin: '10px 0 4px' }

export default function SaveToLeadPicker({ getProgramWindow, getBuildWin, onClose, onSaved, zIndex = 1200 }) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const savingRef = useRef(false)

  const [mode, setMode] = useState('pick')     // 'pick' | 'new'
  const [leads, setLeads] = useState(null)     // null = loading
  const [search, setSearch] = useState('')
  const [chosen, setChosen] = useState(null)   // selected existing lead
  const [form, setForm] = useState({ name: '', phone: '', email: '', zip: '' })
  const [status, setStatus] = useState('')
  const [saved, setSaved] = useState(null)     // { clientId, clientName, quoteNumber } after success

  // On open: prefill the new-lead form from the builder's Client Information
  // section (so info typed there doesn't have to be typed twice) and load leads.
  useEffect(() => {
    const pg = getProgramWindow()
    const val = (id) => { try { return (pg?.document.getElementById(id)?.value || '').trim() } catch { return '' } }
    const name = val('cn')
    setForm({ name, phone: val('cp'), email: val('ce'), zip: val('zip') })
    setMode(name ? 'new' : 'pick')
    let alive = true
    ;(async () => {
      const { data, error } = await supabase
        .from('clients')
        .select('id, name, phone, email, status, updated_at')
        .order('updated_at', { ascending: false })
        .limit(400)
      if (!alive) return
      if (error) { toast(error.message); setLeads([]) } else setLeads(data || [])
    })()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const filtered = useMemo(() => {
    if (!leads) return []
    const q = search.trim().toLowerCase()
    if (!q) return leads.slice(0, 30)
    return leads.filter((l) =>
      (l.name || '').toLowerCase().includes(q)
      || (l.phone || '').replace(/\D/g, '').includes(q.replace(/\D/g, '') || ' ')
      || (l.email || '').toLowerCase().includes(q),
    ).slice(0, 30)
  }, [leads, search])

  async function doSave() {
    if (savingRef.current) return
    const pg = getProgramWindow()
    if (!pg) { toast('The builder is still loading — give it a moment and try again.'); return }

    let target = chosen
    savingRef.current = true
    try {
      if (mode === 'new') {
        const name = form.name.trim()
        if (!name) { toast('Give the new lead a name first.'); savingRef.current = false; return }
        setStatus('Creating lead…')
        const { data, error } = await supabase
          .from('clients')
          .insert({
            name,
            phone: form.phone.trim() || null,
            email: form.email.trim() || null,
            zip: String(form.zip || '').replace(/\D/g, '').slice(0, 5) || null,
            status: 'new_lead',
            primary_rep: user?.id ?? null,
            first_contact_date: isoToday(),
          })
          .select()
          .single()
        if (error) throw error
        target = data
      }
      if (!target?.id) { toast('Pick a lead (or create one) first.'); setStatus(''); savingRef.current = false; return }

      setStatus('Reading quote…')
      const { quote_number, pdfWarn } = await harvestAndSaveQuote({
        pg,
        buildWin: getBuildWin ? getBuildWin() : null,
        client: target,
        onSave: async (payload) => {
          const { error } = await supabase
            .from('quotes')
            .insert({ ...payload, client_id: target.id, created_by: user?.id ?? null })
          if (error) throw error
        },
        setStatus,
      })
      setStatus('')
      savingRef.current = false
      setSaved({ clientId: target.id, clientName: target.name, quoteNumber: quote_number })
      onSaved?.({ clientId: target.id, clientName: target.name, quoteNumber: quote_number, client: target })
      toast(pdfWarn || `Quote ${quote_number} saved to ${target.name}`, pdfWarn ? undefined : 'success')
    } catch (e) {
      setStatus(''); savingRef.current = false
      toast(e.message || 'Could not save the quote.')
    }
  }

  return (
    <div
      role="dialog" aria-modal="true" aria-label="Save build to a lead"
      style={{ position: 'fixed', inset: 0, zIndex, background: 'rgba(4,9,16,.62)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !status) onClose() }}
    >
      <div style={{
        width: 'min(460px, calc(100vw - 32px))', maxHeight: 'calc(100vh - 64px)', overflow: 'auto',
        background: 'var(--card, #0D1929)', border: '1px solid var(--line, #294059)',
        borderRadius: 14, padding: 18, boxShadow: '0 18px 60px rgba(0,0,0,.5)',
      }}>
        {saved ? (
          <>
            <h2 style={{ margin: '2px 0 6px', fontSize: 17 }}>Quote {saved.quoteNumber} saved</h2>
            <p style={{ margin: '0 0 14px', color: 'var(--fg-3, #8598AC)', fontSize: 13.5 }}>
              Saved to <b style={{ color: 'var(--fg, #e2e8f0)' }}>{saved.clientName}</b> — the quote card, PDF and rendering are on their lead page.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={onClose}>Keep building</button>
              <button className="btn-primary" style={{ borderRadius: 8, padding: '9px 14px', fontWeight: 800 }} onClick={() => navigate(`/clients/${saved.clientId}`)}>Go to lead →</button>
            </div>
          </>
        ) : (
          <>
            <h2 style={{ margin: '2px 0 4px', fontSize: 17 }}>Save this build to a lead</h2>
            <p style={{ margin: '0 0 12px', color: 'var(--fg-3, #8598AC)', fontSize: 13 }}>
              Attach the quote + PDF to an existing lead, or create the lead right here.
            </p>

            {/* Mode toggle */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
              {[['pick', 'Existing lead'], ['new', '+ New lead']].map(([k, lbl]) => (
                <button
                  key={k}
                  className="btn btn-ghost"
                  onClick={() => setMode(k)}
                  style={mode === k
                    ? { background: 'var(--cyan, #22c4bf)', color: '#04121a', borderColor: 'transparent', fontWeight: 800 }
                    : undefined}
                >{lbl}</button>
              ))}
            </div>

            {mode === 'pick' && (
              <>
                <input
                  autoFocus
                  style={FIELD}
                  placeholder="Search name, phone or email…"
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setChosen(null) }}
                />
                <div style={{ margin: '10px 0 2px', maxHeight: 260, overflow: 'auto', border: '1px solid var(--line, #294059)', borderRadius: 10 }}>
                  {leads === null && <div style={{ padding: 14, fontSize: 13, color: 'var(--fg-3)' }}>Loading leads…</div>}
                  {leads !== null && filtered.length === 0 && (
                    <div style={{ padding: 14, fontSize: 13, color: 'var(--fg-3)' }}>
                      No matching lead — switch to <b>+ New lead</b> to create one.
                    </div>
                  )}
                  {filtered.map((l) => (
                    <button
                      key={l.id}
                      onClick={() => setChosen(l)}
                      style={{
                        display: 'flex', width: '100%', textAlign: 'left', alignItems: 'center', gap: 10,
                        padding: '9px 12px', background: chosen?.id === l.id ? 'rgba(34,196,191,.14)' : 'transparent',
                        border: 0, borderBottom: '1px solid var(--line-soft, #1b2c42)', cursor: 'pointer', color: 'var(--fg, #e2e8f0)',
                      }}
                    >
                      <span style={{ fontWeight: 700, fontSize: 13.5, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.name || '—'}</span>
                      <span style={{ fontSize: 12, color: 'var(--fg-3, #8598AC)' }}>{l.phone || l.email || ''}</span>
                      {chosen?.id === l.id && <span style={{ color: 'var(--cyan, #22c4bf)', fontWeight: 800 }}>✓</span>}
                    </button>
                  ))}
                </div>
              </>
            )}

            {mode === 'new' && (
              <>
                <label style={LBL}>Name *</label>
                <input style={FIELD} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Full name" autoFocus={!form.name} />
                <label style={LBL}>Phone</label>
                <input style={FIELD} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="(000) 000-0000" />
                <label style={LBL}>Email</label>
                <input style={FIELD} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="email@example.com" />
                <label style={LBL}>Zip Code</label>
                <input style={FIELD} value={form.zip} onChange={(e) => setForm({ ...form, zip: e.target.value })} placeholder="33401" inputMode="numeric" />
                {(form.name || form.phone || form.email) && (
                  <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--fg-3, #8598AC)' }}>
                    Prefilled from the builder's Client Information — edit anything before saving.
                  </p>
                )}
              </>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button className="btn btn-ghost" disabled={!!status} onClick={onClose}>Cancel</button>
              <button
                className="btn-primary"
                style={{ borderRadius: 8, padding: '9px 14px', fontWeight: 800, opacity: (mode === 'pick' && !chosen) ? 0.55 : 1 }}
                disabled={!!status || (mode === 'pick' && !chosen)}
                onClick={doSave}
              >
                {status || (mode === 'new' ? 'Create lead + save quote' : 'Save quote to lead')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
