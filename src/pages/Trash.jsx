// Trash: recover (or permanently remove) soft-deleted leads and quotes.
// Deleting a lead or quote elsewhere sets deleted_at; this is where they live
// until you Restore them (clears deleted_at) or Delete Forever (hard delete).

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { deleteQuotePdf } from '../lib/storage'

const money = (n) => (n == null || n === '' ? '—' : '$' + Number(n).toLocaleString())
const when = (iso) => { try { return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) } catch { return '—' } }

export default function Trash() {
  const [leads, setLeads] = useState([])
  const [quotes, setQuotes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [needsMigration, setNeedsMigration] = useState(false)

  async function load() {
    setLoading(true); setError(''); setNeedsMigration(false)
    const [c, q] = await Promise.all([
      supabase.from('clients').select('id,name,city,county,status,deleted_at').not('deleted_at', 'is', null).order('deleted_at', { ascending: false }),
      supabase.from('quotes').select('id,client_id,quote_number,building_size,total_amount,deleted_at,pdf_snapshot_url').not('deleted_at', 'is', null).order('deleted_at', { ascending: false }),
    ])
    const err = c.error || q.error
    if (err) {
      const m = (err.message || '').toLowerCase()
      if (m.includes('deleted_at') || m.includes('column') || m.includes('schema cache')) { setNeedsMigration(true); setLoading(false); return }
      setError(err.message); setLoading(false); return
    }
    setLeads(c.data ?? []); setQuotes(q.data ?? []); setLoading(false)
  }
  useEffect(() => { load() /* eslint-disable-next-line */ }, [])

  async function restoreLead(id) { const { error } = await supabase.from('clients').update({ deleted_at: null, deleted_by: null }).eq('id', id); if (error) setError(error.message); else load() }
  async function purgeLead(id) {
    if (!window.confirm('Permanently delete this lead and all its quotes & activity? This cannot be undone.')) return
    const { error } = await supabase.from('clients').delete().eq('id', id); if (error) setError(error.message); else load()
  }
  async function restoreQuote(id) { const { error } = await supabase.from('quotes').update({ deleted_at: null, deleted_by: null }).eq('id', id); if (error) setError(error.message); else load() }
  async function purgeQuote(qr) {
    if (!window.confirm('Permanently delete this quote? This cannot be undone.')) return
    if (qr.pdf_snapshot_url) { try { await deleteQuotePdf(qr.pdf_snapshot_url) } catch { /* best effort */ } }
    const { error } = await supabase.from('quotes').delete().eq('id', qr.id); if (error) setError(error.message); else load()
  }

  const total = leads.length + quotes.length

  return (
    <>
      <div className="page-head">
        <div className="left">
          <div className="eyebrow-lime">Recovery</div>
          <h1>Trash</h1>
          <div className="sub">Deleted leads &amp; quotes — restore anything here, or remove it for good.</div>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {needsMigration ? (
        <section className="tile"><div className="list-empty">Recovery needs the one-time database update (migration 017). Run it in Supabase, then deleted items will show here.</div></section>
      ) : loading ? (
        <section className="tile"><div className="muted" style={{ padding: 20 }}>Loading…</div></section>
      ) : total === 0 ? (
        <section className="tile"><div className="list-empty">Trash is empty — nothing has been deleted.</div></section>
      ) : (
        <>
          <section className="tile" style={{ marginBottom: 18 }}>
            <div className="tile-head"><h3>Deleted Leads <span className="muted">· {leads.length}</span></h3></div>
            {leads.length === 0 ? <div className="list-empty">No deleted leads.</div> : (
              <table className="dt">
                <thead><tr><th>Client</th><th>Location</th><th>Deleted</th><th>Actions</th></tr></thead>
                <tbody>
                  {leads.map(c => (
                    <tr key={c.id}>
                      <td><b>{c.name || '—'}</b></td>
                      <td>{[c.city, c.county].filter(Boolean).join(', ') || '—'}</td>
                      <td className="num">{when(c.deleted_at)}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 10 }}>
                          <button className="link-btn" onClick={() => restoreLead(c.id)}>Restore</button>
                          <button className="link-btn link-btn-danger" onClick={() => purgeLead(c.id)}>Delete Forever</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="tile">
            <div className="tile-head"><h3>Deleted Quotes <span className="muted">· {quotes.length}</span></h3></div>
            {quotes.length === 0 ? <div className="list-empty">No deleted quotes.</div> : (
              <table className="dt">
                <thead><tr><th>Quote</th><th>Size</th><th>Total</th><th>Deleted</th><th>Actions</th></tr></thead>
                <tbody>
                  {quotes.map(q => (
                    <tr key={q.id}>
                      <td>{q.quote_number ? <b>#{q.quote_number}</b> : <Link to={`/clients/${q.client_id}`}>View lead</Link>}</td>
                      <td className="num">{q.building_size || '—'}</td>
                      <td className="num">{money(q.total_amount)}</td>
                      <td className="num">{when(q.deleted_at)}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 10 }}>
                          <button className="link-btn" onClick={() => restoreQuote(q.id)}>Restore</button>
                          <button className="link-btn link-btn-danger" onClick={() => purgeQuote(q)}>Delete Forever</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </>
  )
}
