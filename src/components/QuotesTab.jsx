// QuotesTab: lives inside the ClientDetail page. Shows all quotes for
// this client in a small table. Add / edit / delete / view PDF.

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { getQuotePdfSignedUrl, deleteQuotePdf } from '../lib/storage'
import QuoteForm from './QuoteForm'
import QuoteStatusPill from './QuoteStatusPill'
import QuoteDeck from './QuoteDeck'
import QuoteBuilderModal from './QuoteBuilderModal'

export default function QuotesTab({ clientId, client, clientBuildingSize }) {
  const { user } = useAuth()
  const [quotes, setQuotes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [adding, setAdding] = useState(false)
  const [building, setBuilding] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [confirmingDeleteId, setConfirmingDeleteId] = useState(null)
  const [viewMode, setViewMode] = useState('deck') // 'deck' | 'list'

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
    const { error } = await supabase
      .from('quotes')
      .delete()
      .eq('id', quote.id)
    if (error) {
      setError(error.message)
    }
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

  return (
    <div className="quotes-tab">
      <div className="quotes-tab-header">
        <div className="detail-card-title">Quotes</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {quotes.length > 0 && !adding && !editingId && (
            <div className="qd-toggle">
              <button className={viewMode === 'deck' ? 'on' : ''} onClick={() => setViewMode('deck')}>Deck</button>
              <button className={viewMode === 'list' ? 'on' : ''} onClick={() => setViewMode('list')}>List</button>
            </div>
          )}
          {!adding && !editingId && (
            <>
              <button onClick={() => setBuilding(true)} className="btn-primary">Build Quote</button>
              <button onClick={() => setAdding(true)} className="btn-secondary">Add Manually</button>
            </>
          )}
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {building && (
        <QuoteBuilderModal
          client={client ?? { id: clientId }}
          onSave={handleBuildSave}
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

      {loading ? (
        <div className="muted" style={{padding: '8px 0'}}>Loading quotes…</div>
      ) : quotes.length === 0 && !adding ? (
        <div className="muted" style={{padding: '12px 0'}}>No quotes yet.</div>
      ) : viewMode === 'deck' && !editingId && !adding ? (
        <QuoteDeck
          quotes={quotes}
          onOpen={openFromDeck}
          onViewPdf={handleViewPdf}
          onAccept={handleAccept}
        />
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
    </div>
  )
}

function formatDate(yyyyMMdd) {
  if (!yyyyMMdd) return '—'
  const [y, m, d] = yyyyMMdd.split('-')
  return `${m}/${d}/${y}`
}
