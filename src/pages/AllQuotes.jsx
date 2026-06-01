// AllQuotes: a global roll-up of every quote across all clients — one place to
// find any quote from any device. (Quotes have always lived in Supabase, so
// they're already cross-device; per-client quotes still live on each client's
// Quotes tab. This is the cross-client list.) Live-updates via realtime.

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { getQuotePdfSignedUrl } from '../lib/storage'
import QuoteStatusPill from '../components/QuoteStatusPill'

function fmtDate(s) {
  if (!s) return '—'
  const [y, m, d] = s.split('-')
  return `${m}/${d}/${y}`
}
function fmtMoney(n) {
  if (n == null) return '—'
  return '$' + Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })
}

export default function AllQuotes() {
  const navigate = useNavigate()
  const [quotes, setQuotes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      // Join the client name in one round-trip via the quotes→clients FK.
      const { data, error } = await supabase
        .from('quotes')
        .select('*, client:clients(name)')
        .order('quote_date', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
      if (cancelled) return
      if (error) setError(error.message)
      else setQuotes(data ?? [])
      setLoading(false)
    }
    load()
    const ch = supabase
      .channel('all-quotes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'quotes' }, () => load())
      .subscribe()
    return () => { cancelled = true; supabase.removeChannel(ch) }
  }, [])

  async function viewPdf(path) {
    try {
      const url = await getQuotePdfSignedUrl(path)
      window.open(url, '_blank')
    } catch (e) {
      setError('Could not open PDF: ' + e.message)
    }
  }

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return quotes
    return quotes.filter(x =>
      (x.client?.name && x.client.name.toLowerCase().includes(q)) ||
      (x.quote_number && x.quote_number.toLowerCase().includes(q)) ||
      (x.building_size && x.building_size.toLowerCase().includes(q))
    )
  }, [quotes, search])

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>All Quotes</h1>
          <p className="muted">
            {visible.length} {visible.length === 1 ? 'quote' : 'quotes'} · every client, synced across devices
          </p>
        </div>
      </div>

      <div className="filters-bar">
        <input
          type="text"
          placeholder="Search by client, quote #, or size…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="filter-search"
        />
      </div>

      {error && <div className="error-banner">{error}</div>}

      {loading ? (
        <div className="muted" style={{ padding: '24px 0' }}>Loading quotes…</div>
      ) : visible.length === 0 ? (
        <div className="empty-state">
          {quotes.length === 0
            ? 'No quotes yet. Build one from a client’s Quotes tab (use “Save to CRM”).'
            : 'No quotes match your search.'}
        </div>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Quote #</th>
                <th>Client</th>
                <th>Building</th>
                <th>Total</th>
                <th>Status</th>
                <th>PDF</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((q, i) => (
                <tr
                  key={q.id}
                  onClick={() => q.client_id && navigate(`/clients/${q.client_id}`)}
                  className="row-clickable row-enter"
                  style={{ '--ri': Math.min(i, 14) }}
                >
                  <td>{fmtDate(q.quote_date)}</td>
                  <td>{q.quote_number || '—'}</td>
                  <td><div className="cell-primary">{q.client?.name || '—'}</div></td>
                  <td>{q.building_size || '—'}</td>
                  <td><div className="cell-primary">{fmtMoney(q.total_amount)}</div></td>
                  <td><QuoteStatusPill status={q.status} /></td>
                  <td>
                    {q.pdf_snapshot_url
                      ? <button className="link-btn" onClick={(e) => { e.stopPropagation(); viewPdf(q.pdf_snapshot_url) }}>View PDF</button>
                      : <span className="muted">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
