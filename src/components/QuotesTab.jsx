// QuotesTab: lives inside the ClientDetail page. Shows all quotes for
// this client in a small table. Add / edit / delete / view PDF.

import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { getQuotePdfSignedUrl, deleteQuotePdf } from '../lib/storage'
import { quoteStatusLabel } from '../lib/constants'
import QuoteForm from './QuoteForm'
import QuoteStatusPill from './QuoteStatusPill'
import QuoteDeck from './QuoteDeck'
import BuildQuoteModal from './BuildQuoteModal'

const money = (n) => (n == null || n === '' ? null : '$' + Number(n).toLocaleString())

export default function QuotesTab({ clientId, client, clientBuildingSize, building: buildingProp, setBuilding: setBuildingProp }) {
  const { user } = useAuth()
  const [quotes, setQuotes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [adding, setAdding] = useState(false)
  // "Build Quote" can be triggered from here OR from the Document Hub menu, so
  // the parent (ClientDetail) may own this state. Fall back to local state.
  const [buildingInner, setBuildingInner] = useState(false)
  const building = buildingProp ?? buildingInner
  const setBuilding = setBuildingProp ?? setBuildingInner
  const [editingId, setEditingId] = useState(null)
  const [confirmingDeleteId, setConfirmingDeleteId] = useState(null)
  const [viewMode, setViewMode] = useState('deck') // 'deck' | 'spread' | 'list'

  // Load quotes + subscribe to changes
  useEffect(() => {
    let cancelled = false

    async function load() {
      const { data, error } = await supabase
        .from('quotes')
        .select('*')
        .eq('client_id', clientId)
        .order('quote_date', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })

      if (cancelled) return
      if (error) setError(error.message)
      else setQuotes(data ?? [])
      setLoading(false)
    }
    load()

    const channel = supabase
      .channel(`quotes-${clientId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'quotes', filter: `client_id=eq.${clientId}` },
        () => load()
      )
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [clientId])

  async function handleCreate(payload) {
    const { error } = await supabase
      .from('quotes')
      .insert({ ...payload, client_id: clientId, created_by: user.id })
    if (error) throw error
    setAdding(false)
  }

  // Save from the embedded quote builder. Reuses the same insert path; on
  // failure handleCreate throws so the modal surfaces the error and stays open.
  async function handleBuildSave(payload) {
    await handleCreate(payload)
    setBuilding(false)
  }

  async function handleUpdate(id, payload) {
    const { error } = await supabase
      .from('quotes')
      .update(payload)
      .eq('id', id)
    if (error) throw error
    setEditingId(null)
  }

  async function handleDelete(quote) {
    // Best-effort: try to delete the PDF from storage too. We don't
    // block the delete on this — if the PDF cleanup fails we still
    // want the DB row gone.
    if (quote.pdf_snapshot_url) {
      try { await deleteQuotePdf(quote.pdf_snapshot_url) } catch {}
    }
    // .select() returns the rows actually removed — so we can tell a real delete
    // from one silently blocked by RLS (0 rows, no error).
    const { data, error } = await supabase
      .from('quotes')
      .delete()
      .eq('id', quote.id)
      .select('id')
    if (error) {
      setError(error.message)
      return
    }
    if (!data || data.length === 0) {
      setError('Could not delete this quote — the database blocked it (permission). Run the quotes delete-policy update.')
      return
    }
    // Remove it from the UI right away. Realtime DELETE events don't carry
    // client_id, so the filtered subscription can miss them — this guarantees
    // the deck/list updates immediately instead of showing a ghost quote.
    setQuotes(qs => qs.filter(x => x.id !== quote.id))
    setConfirmingDeleteId(null)
  }

  async function handleViewPdf(path) {
    try {
      const url = await getQuotePdfSignedUrl(path)
      window.open(url, '_blank')
    } catch (err) {
      setError('Could not open PDF: ' + err.message)
    }
  }

  async function handleAccept(quote) {
    if (!quote) return
    const { error } = await supabase
      .from('quotes')
      .update({ status: 'verbal_accept' })
      .eq('id', quote.id)
    if (error) setError(error.message)
  }

  function openFromDeck(quote) {
    setEditingId(quote.id)
    setViewMode('list')
  }

  // Delete straight from the deck / spread card (the list view has its own inline confirm).
  function confirmDeleteQuote(quote) {
    if (window.confirm('Delete this quote? The PDF will also be removed. This cannot be undone.')) {
      handleDelete(quote)
    }
  }

  return (
    <section className="card card-pad quotes-tab">
      <div className="section-head">
        <h3>Quotes</h3>
        <div className="quotes-head-actions">
          {quotes.length > 0 && !adding && !editingId && (
            <div className="seg">
              <button className={viewMode === 'deck' ? 'active' : ''} onClick={() => setViewMode('deck')}>Deck</button>
              <button className={viewMode === 'spread' ? 'active' : ''} onClick={() => setViewMode('spread')}>Spread</button>
              <button className={viewMode === 'list' ? 'active' : ''} onClick={() => setViewMode('list')}>List</button>
            </div>
          )}
          {!adding && !editingId && (
            <>
              <button onClick={() => setBuilding(true)} className="btn btn-primary">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>Build Quote
              </button>
              <button onClick={() => setAdding(true)} className="btn btn-ghost">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>Add Manually
              </button>
            </>
          )}
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {building && (
        <BuildQuoteModal
          client={client ?? { id: clientId }}
          onSave={handleCreate}
          onClose={() => setBuilding(false)}
        />
      )}

      {adding && (
        <div className="quote-form-wrap">
          <QuoteForm
            clientId={clientId}
            defaultBuildingSize={clientBuildingSize}
            onSubmit={handleCreate}
            onCancel={() => setAdding(false)}
            submitLabel="Add Quote"
          />
        </div>
      )}

      {/* While the builder modal is open, don't render the deck/list at all —
          it prevents the saved-quote card from showing through the modal and
          unmounts the deck's global arrow-key listener so keys don't leak. */}
      {building ? null : loading ? (
        <div className="muted" style={{padding: '8px 0'}}>Loading quotes…</div>
      ) : quotes.length === 0 && !adding ? (
        <div className="muted" style={{padding: '12px 0'}}>No quotes yet.</div>
      ) : viewMode === 'deck' && !editingId && !adding ? (
        <QuoteDeck
          quotes={quotes}
          onOpen={openFromDeck}
          onViewPdf={handleViewPdf}
          onAccept={handleAccept}
          onDelete={confirmDeleteQuote}
        />
      ) : viewMode === 'spread' && !editingId && !adding ? (
        <QuoteSpread quotes={quotes} onOpen={openFromDeck} onViewPdf={handleViewPdf} onDelete={confirmDeleteQuote} />
      ) : (
        <div className="quotes-list">
          {quotes.map(q =>
            editingId === q.id ? (
              <div key={q.id} className="quote-form-wrap">
                <QuoteForm
                  clientId={clientId}
                  initial={q}
                  onSubmit={(payload) => handleUpdate(q.id, payload)}
                  onCancel={() => setEditingId(null)}
                  submitLabel="Save Changes"
                />
              </div>
            ) : (
              <div key={q.id} className="quote-row">
                <div className="quote-row-main">
                  <div className="quote-row-top">
                    <span className="quote-date">{formatDate(q.quote_date)}</span>
                    {q.quote_number && <span className="quote-number">#{q.quote_number}</span>}
                    <QuoteStatusPill status={q.status} />
                  </div>
                  <div className="quote-row-meta">
                    {q.building_size && <span>{q.building_size}</span>}
                    {q.notes && <span className="muted"> · {q.notes}</span>}
                  </div>
                </div>
                <div className="quote-row-actions">
                  {q.pdf_snapshot_url && (
                    <button onClick={() => handleViewPdf(q.pdf_snapshot_url)} className="link-btn">
                      View PDF
                    </button>
                  )}
                  <button onClick={() => setEditingId(q.id)} className="link-btn">Edit</button>
                  <button onClick={() => setConfirmingDeleteId(q.id)} className="link-btn link-btn-danger">
                    Delete
                  </button>
                </div>

                {confirmingDeleteId === q.id && (
                  <div className="confirm-card" style={{marginTop: 8, gridColumn: '1 / -1'}}>
                    <div>
                      <strong>Delete this quote?</strong>
                      <div className="muted" style={{marginTop: 4, fontSize: 13}}>
                        The PDF will also be removed. Cannot be undone.
                      </div>
                    </div>
                    <div style={{display: 'flex', gap: 8}}>
                      <button onClick={() => setConfirmingDeleteId(null)} className="btn-secondary">Cancel</button>
                      <button onClick={() => handleDelete(q)} className="btn-danger">Yes, delete</button>
                    </div>
                  </div>
                )}
              </div>
            )
          )}
        </div>
      )}
    </section>
  )
}

function formatDate(yyyyMMdd) {
  if (!yyyyMMdd) return '—'
  const [y, m, d] = yyyyMMdd.split('-')
  return `${m}/${d}/${y}`
}

// Spread view — all quotes side by side in a scroll row (design .spread-grid).
function QuoteSpread({ quotes, onOpen, onViewPdf, onDelete }) {
  const ref = useRef(null)
  useEffect(() => {
    const els = ref.current ? [...ref.current.querySelectorAll('.spread-card')] : []
    const timers = els.map((el, i) => setTimeout(() => el.classList.add('in'), 40 + i * 55))
    return () => timers.forEach(clearTimeout)
  }, [quotes])
  return (
    <div className="spread-scroll" ref={ref}>
      <div className="spread-grid">
        {quotes.map(q => <SpreadCard key={q.id} q={q} onOpen={onOpen} onViewPdf={onViewPdf} onDelete={onDelete} />)}
      </div>
    </div>
  )
}

function SpreadCard({ q, onOpen, onViewPdf, onDelete }) {
  return (
    <div className="spread-card" onClick={(e) => { if (e.target.closest('button')) return; onOpen(q) }}>
      <div className="q-head">
        <div>
          <div className="q-id">{q.quote_number ? '#' + q.quote_number : 'QUOTE'}</div>
          <div className="q-size" style={{ fontSize: 24 }}>{q.building_size || '—'}</div>
        </div>
        <span className="q-badge">{quoteStatusLabel(q.status)}</span>
      </div>
      {q.building_summary && <div className="q-sub">{q.building_summary}</div>}
      <div className="q-figures">
        <div className="q-fig"><div className="l">Deposit</div><div className="n num">{money(q.deposit_amount) || '—'}</div></div>
        <div className="q-fig"><div className="l">Balance</div><div className="n num">{money(q.balance_amount) || '—'}</div></div>
      </div>
      <div className="q-divider" />
      <div className="q-total"><div className="l">Total</div><div className="v num">{money(q.total_amount) || '—'}</div></div>
      <div className="q-actions">
        {q.pdf_snapshot_url && <button className="btn btn-ghost" onClick={() => onViewPdf(q.pdf_snapshot_url)}>PDF</button>}
        <button className="btn btn-primary" onClick={() => onOpen(q)}>Open / Edit</button>
        {onDelete && <button className="btn btn-ghost" onClick={() => onDelete(q)} style={{ color: 'var(--danger)' }}>Delete</button>}
      </div>
    </div>
  )
}
