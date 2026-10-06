// QuotesTab: lives inside the ClientDetail page. Shows all quotes for
// this client in a small table. Add / edit / delete / view PDF.

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'
import { promoteToWorking } from '../lib/promoteLead'
import { useAuth } from '../context/AuthContext'
import { getQuotePdfSignedUrl, deleteQuotePdf, deleteDoc } from '../lib/storage'
import { useUsers } from '../lib/useUsers'
import QuoteForm from './QuoteForm'
import QuoteStatusPill from './QuoteStatusPill'
import ReplacedBadge from './ReplacedBadge'
import QuoteDeck from './QuoteDeck'
import BuildQuoteModal from './BuildQuoteModal'
import ReceiptModal from './ReceiptModal'
import ColorSheetModal from './ColorSheetModal'
import { openMenu, toast } from '../lib/uiFx'
import RevisionModal from './RevisionModal'
import { guardBuilderUpdate, isBuilderPayload, stripForDuplicate } from '../lib/priceLockCrm'
import { applyStar, sortStarredFirst, starSupported } from '../lib/layoutFromQuote'
import { StarBadge, StarButton } from './QuoteStar'

const money = (n) => (n == null || n === '' ? null : '$' + Number(n).toLocaleString())

export default function QuotesTab({ clientId, client, clientBuildingSize, building: buildingProp, setBuilding: setBuildingProp }) {
  const { user } = useAuth()
  const { users } = useUsers()
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
  const [editQuote, setEditQuote] = useState(null) // a builder-built quote being reopened in the 3D builder
  const [autoContract, setAutoContract] = useState(false) // opened via "Generate Contract" → auto-run contract flow
  const [autoExec, setAutoExec] = useState(false) // opened via "Executed Copy" → auto-run the watermarked deposit-paid contract
  const [revisionChanges, setRevisionChanges] = useState(null) // revision rows to auto-apply in the builder
  const [confirmingDeleteId, setConfirmingDeleteId] = useState(null)
  const [viewMode, setViewMode] = useState('deck') // 'deck' | 'spread' | 'list'
  const [pdfUrl, setPdfUrl] = useState(null) // open the quote PDF in an in-app viewer
  const [starBusy, setStarBusy] = useState(false)
  const reloadRef = useRef(null)

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
      // Starred quote first (when quotes.starred exists), then newest.
      else setQuotes(sortStarredFirst(data ?? []))
      setLoading(false)
    }
    load()
    reloadRef.current = load

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
    // A saved quote = the lead has been quoted → Working Leads (forward-only).
    promoteToWorking(clientId, user?.id).catch(() => {})
    setAdding(false)
  }

  // Save from the embedded quote builder. Reuses the same insert path; on
  // failure handleCreate throws so the modal surfaces the error and stays open.
  async function handleBuildSave(payload) {
    await handleCreate(payload)
    setBuilding(false)
  }

  // Duplicate a quote → a fresh draft (new number + today's date, no PDF yet).
  // Keeps the builder config + rendering thumbnail so it opens ready to tweak.
  // Price lock (9/30/26): a BUILDER quote's copy is priced exactly like a
  // brand-new quote for the same building — no saved price, snapshot, rule
  // overrides, Pricing-tab edits, Honor Signed Pricing or history are carried
  // over (stripForDuplicate), its card shows no total until it is saved, and it
  // opens in the builder at today's pricing.
  // Manually-added quotes (no build to reprice) copy their typed totals as before.
  async function handleDuplicate(quote) {
    const now = new Date()
    const { id, created_at, updated_at, deleted_at, deleted_by, ...rest } = quote
    const quote_number = `SS-${now.getFullYear()}-${String(Date.now()).slice(-5)}`
    const builder = isBuilderPayload(quote.payload_json)
    const copy = {
      ...rest,
      client_id: clientId,
      created_by: user?.id ?? null,
      quote_date: now.toISOString().slice(0, 10),
      quote_number,
      status: 'draft',
      pdf_snapshot_url: null,
      // One starred quote per lead — a copy starts unstarred.
      ...(Object.prototype.hasOwnProperty.call(quote, 'starred') ? { starred: false } : {}),
      valid_through: new Date(now.getTime() + 30 * 86400000).toISOString().slice(0, 10),
      ...(builder ? {
        total_amount: null, deposit_amount: null, balance_amount: null,
        payload_json: stripForDuplicate(quote.payload_json, { fromQuote: quote, newNumber: quote_number, now }),
      } : {}),
    }
    const { data, error } = await supabase.from('quotes').insert(copy).select().single()
    if (error) { setError(error.message); return }
    if (builder && data && data.payload_json?.fields) {
      toast(`Copy ${quote_number} created — opening it at today's pricing. Save to Lead to keep its price.`, 'success')
      setEditQuote(data)
      setBuilding(true)
    }
  }

  // Star / unstar a quote (one per lead). Optimistic: the list updates at once;
  // the DB unstars the lead's other quotes first, then stars this one (the
  // partial unique index allows only one). On any failure the list goes back
  // and is re-read from the database, with a toast.
  const canStar = starSupported(quotes)
  async function toggleStar(quote) {
    if (starBusy || !quote) return
    const on = quote.starred !== true
    const before = quotes
    const prevStar = quotes.find(q => q.starred === true && q.id !== quote.id) || null
    let unstarred = false
    setQuotes(qs => sortStarredFirst(applyStar(qs, quote.id, on)))
    setStarBusy(true)
    try {
      if (on) {
        const { error: e1 } = await supabase.from('quotes').update({ starred: false })
          .eq('client_id', clientId).eq('starred', true).neq('id', quote.id)
        if (e1) throw e1
        unstarred = !!prevStar
      }
      const { data, error: e2 } = await supabase.from('quotes').update({ starred: on }).eq('id', quote.id).select('id')
      if (e2) throw e2
      if (!data || data.length === 0) throw new Error('the database blocked it (permission)')
      toast(on ? `Quote ${quote.quote_number ? '#' + quote.quote_number + ' ' : ''}starred — Open Layout will use it` : 'Star removed', 'success')
    } catch (err) {
      // Put the previous star back if it was already cleared (best effort).
      if (unstarred && prevStar) {
        try { await supabase.from('quotes').update({ starred: true }).eq('id', prevStar.id) } catch { /* reload below shows the truth */ }
      }
      setQuotes(before)
      toast('Could not update the star — ' + (err?.message || 'please try again.'))
      try { reloadRef.current && reloadRef.current() } catch { /* ignore */ }
    } finally {
      setStarBusy(false)
    }
  }

  async function handleUpdate(id, payload) {
    const { error } = await supabase
      .from('quotes')
      .update(payload)
      .eq('id', id)
    if (error) throw error
    setEditingId(null)
  }

  // Re-save an edited builder quote onto the SAME row, keeping its original
  // quote number + date so it stays the same quote — just revised. A sold
  // status (verbal accept / deposit paid / revised) and the notes are never
  // overwritten by a builder save (guardBuilderUpdate — second guard after
  // builderSave's planQuoteFields).
  async function handleBuildUpdate(original, payload) {
    const { quote_number, quote_date, ...rest } = payload
    const { error } = await supabase
      .from('quotes')
      .update({ ...guardBuilderUpdate(original, rest), quote_number: original.quote_number ?? quote_number, quote_date: original.quote_date ?? quote_date })
      .eq('id', original.id)
    if (error) throw error
  }

  async function handleDelete(quote) {
    // Soft-delete — keep the PDF + row so the quote can be restored from Trash.
    const { data, error } = await supabase
      .from('quotes')
      .update({ deleted_at: new Date().toISOString(), deleted_by: user?.id ?? null })
      .eq('id', quote.id)
      .select('id')
    if (error) {
      const m = (error.message || '').toLowerCase()
      setError(m.includes('deleted_at') || m.includes('column') || m.includes('schema cache')
        ? 'Recovery needs the one-time database update (migration 017) before deleting.'
        : error.message)
      return
    }
    if (!data || data.length === 0) {
      setError('Could not delete this quote — the database blocked it (permission).')
      return
    }
    // Remove it from the UI right away. Realtime DELETE events don't carry
    // client_id, so the filtered subscription can miss them — this guarantees
    // the deck/list updates immediately instead of showing a ghost quote.
    setQuotes(qs => qs.filter(x => x.id !== quote.id))
    setConfirmingDeleteId(null)
    // Mirror the deletion into the Document Hub — remove this quote's PDF too so
    // the Quotes box and the Hub stay in lockstep (config stays in payload_json).
    if (quote.pdf_snapshot_url) {
      try { await deleteDoc(quote.pdf_snapshot_url) } catch { /* ignore */ }
      try { window.dispatchEvent(new CustomEvent('ss:docs-updated', { detail: { clientId } })) } catch { /* ignore */ }
    }
  }

  async function handleViewPdf(path) {
    // Open in an in-app viewer (iframe) rather than window.open — the desktop
    // app's window-open handler can swallow external popups, so this is reliable.
    try {
      const url = await getQuotePdfSignedUrl(path)
      if (url) setPdfUrl(url)
      else setError('No PDF is attached to this quote.')
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

  // Open / Edit a quote. Quotes built in the 3D builder carry their full state
  // in payload_json — reopen those in the builder (adjust → re-save → contract).
  // Manually-added / uploaded quotes (no builder state) open the details form.
  function openQuote(quote) {
    const data = quote.payload_json
    const isBuilderQuote = !!(data && (data.fields || data.source === '3d-builder'))
    if (isBuilderQuote) {
      setEditQuote(quote)
      setBuilding(true)
    } else {
      setEditingId(quote.id)
      setViewMode('list')
    }
  }

  // "Generate Contract" from a quote card. Contracts render from the builder's
  // full build state, so this reopens the quote in the builder and auto-runs the
  // program's Generate Contract (which saves a PDF to Documents › Contracts).
  const isBuilderQuote = (q) => !!(q?.payload_json && (q.payload_json.fields || q.payload_json.source === '3d-builder'))
  function handleGenerateContract(quote) {
    if (!isBuilderQuote(quote)) {
      setError('This quote was added manually, so there’s no build to generate a contract from. Build it in the 3D quote builder first.')
      return
    }
    setEditQuote(quote)
    setAutoContract(true)
    setBuilding(true)
  }

  // "Executed Copy" — the fully-signed, deposit-collected copy: same contract
  // with the StormSafe logo + DEPOSIT PAID stamp on every page. Sent back to the
  // client after both signatures; doubles as the bill of sale.
  function handleExecutedCopy(quote) {
    if (!isBuilderQuote(quote)) {
      setError('This quote was added manually, so there’s no build to generate an executed copy from. Build it in the 3D quote builder first.')
      return
    }
    setEditQuote(quote)
    setAutoExec(true)
    setBuilding(true)
  }

  // "Revision Form" from a quote card — for changes to an already-signed order
  // (colors, doors, size). Opens the typed RevisionModal: the rep fills the
  // change rows on screen and gets a finished PDF (no handwriting).
  const [revisionQuote, setRevisionQuote] = useState(null)
  const handleRevisionForm = setRevisionQuote

  // Delete straight from the deck / spread card (the list view has its own inline confirm).
  function confirmDeleteQuote(quote) {
    if (window.confirm('Delete this quote? The PDF will also be removed. This cannot be undone.')) {
      handleDelete(quote)
    }
  }

  // "Payment Receipt" — branded receipt PDF for a payment on this quote
  // (deposit, progress or final). Works for manual quotes too; only needs
  // amounts, not a saved build.
  const [receiptQuote, setReceiptQuote] = useState(null)

  // "Color Sheet" — clients often order with colors TBD; when they choose,
  // this generates the manufacturer color-selection sheet for the order.
  const [colorQuote, setColorQuote] = useState(null)

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
              <button onClick={() => { setEditQuote(null); setBuilding(true) }} className="btn btn-primary">
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
          key={editQuote?.id || 'new'}
          client={client ?? { id: clientId }}
          initialQuote={editQuote}
          autoContract={autoContract}
          autoExec={autoExec}
          revisionChanges={revisionChanges}
          onSave={editQuote ? (payload) => handleBuildUpdate(editQuote, payload) : handleCreate}
          onClose={() => { setBuilding(false); setEditQuote(null); setAutoContract(false); setAutoExec(false); setRevisionChanges(null) }}
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
          users={users}
          onOpen={openQuote}
          onViewPdf={handleViewPdf}
          onDelete={confirmDeleteQuote}
          onDuplicate={handleDuplicate}
          onGenerateContract={handleGenerateContract}
          onExecutedCopy={handleExecutedCopy}
          onRevisionForm={handleRevisionForm}
          onReceipt={setReceiptQuote}
          onColorSheet={setColorQuote}
          onToggleStar={canStar ? toggleStar : null}
          starBusy={starBusy}
        />
      ) : viewMode === 'spread' && !editingId && !adding ? (
        <QuoteSpread quotes={quotes} onToggleStar={canStar ? toggleStar : null} starBusy={starBusy} onOpen={openQuote} onViewPdf={handleViewPdf} onDelete={confirmDeleteQuote} onDuplicate={handleDuplicate} onGenerateContract={handleGenerateContract} onExecutedCopy={handleExecutedCopy} onRevisionForm={handleRevisionForm} onReceipt={setReceiptQuote} onColorSheet={setColorQuote} />
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
              <div key={q.id} className={`quote-row${q.starred === true ? ' is-starred' : ''}`}>
                <div className="quote-row-main">
                  <div className="quote-row-top">
                    <span className="quote-date">{formatDate(q.quote_date)}</span>
                    {q.quote_number && <span className="quote-number">#{q.quote_number}</span>}
                    <QuoteStatusPill status={q.status} />
                    <ReplacedBadge quote={q} />
                    <StarBadge quote={q} />
                  </div>
                  <div className="quote-row-meta">
                    {q.building_size && <span>{q.building_size}</span>}
                    {q.notes && <span className="muted"> · {q.notes}</span>}
                  </div>
                </div>
                <div className="quote-row-actions">
                  <StarButton quote={q} onToggle={canStar ? toggleStar : null} busy={starBusy} />
                  {q.pdf_snapshot_url && (
                    <button onClick={() => handleViewPdf(q.pdf_snapshot_url)} className="link-btn">
                      View PDF
                    </button>
                  )}
                  <button onClick={() => setReceiptQuote(q)} className="link-btn">{q.manufacturer === 'cci' ? 'Bill of Sale' : 'Receipt'}</button>
                  <button onClick={() => setColorQuote(q)} className="link-btn">Color Sheet</button>
                  <button onClick={() => handleRevisionForm(q)} className="link-btn">Revision Order</button>
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

      {receiptQuote && (
        <ReceiptModal
          client={client ?? { id: clientId }}
          quote={receiptQuote}
          onClose={() => setReceiptQuote(null)}
        />
      )}

      {colorQuote && (
        <ColorSheetModal
          client={client ?? { id: clientId }}
          quote={colorQuote}
          onClose={() => setColorQuote(null)}
        />
      )}

      {revisionQuote && (
        <RevisionModal
          client={client ?? { id: clientId }}
          quote={revisionQuote}
          onClose={() => setRevisionQuote(null)}
          onApplyToBuild={(changes) => {
            // "Generate + Apply to Building": reopen the quote in the builder
            // with the revision's component changes pre-applied — the rep drags
            // placements, then Generate Contract prints the revised contract
            // with renderings + the spacing sheet reflecting the changes.
            const q = revisionQuote
            setRevisionQuote(null)
            setEditQuote(q)
            setRevisionChanges(changes)
            setBuilding(true)
          }}
        />
      )}

      {pdfUrl && createPortal(
        <div className="fum-overlay" role="dialog" aria-modal="true" aria-label="Quote PDF" onClick={() => setPdfUrl(null)} style={{ zIndex: 200 }}>
          <div onClick={e => e.stopPropagation()} style={{ width: '92vw', height: '92vh', maxWidth: 1100, background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid var(--line)' }}>
              <strong style={{ fontFamily: 'var(--font-head)', fontSize: 13, letterSpacing: '.04em', textTransform: 'uppercase' }}>Quote PDF</strong>
              <div style={{ display: 'flex', gap: 8 }}>
                <a className="btn-secondary" href={pdfUrl} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>Open in browser</a>
                <button className="btn-secondary" onClick={() => setPdfUrl(null)}>Close</button>
              </div>
            </div>
            <iframe src={pdfUrl} title="Quote PDF" style={{ flex: 1, width: '100%', border: 0, background: '#fff' }} />
          </div>
        </div>,
        document.body
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
function QuoteSpread({ quotes, onToggleStar, starBusy, onOpen, onViewPdf, onDelete, onDuplicate, onGenerateContract, onExecutedCopy, onRevisionForm, onReceipt, onColorSheet }) {
  const ref = useRef(null)
  useEffect(() => {
    const els = ref.current ? [...ref.current.querySelectorAll('.spread-card')] : []
    const timers = els.map((el, i) => setTimeout(() => el.classList.add('in'), 40 + i * 55))
    return () => timers.forEach(clearTimeout)
  }, [quotes])
  const scrollBy = (dir) => ref.current?.scrollBy({ left: dir * 320, behavior: 'smooth' })
  const many = quotes.length > 3
  return (
    <div className="spread-wrap">
      {many && <button className="spread-arrow left" onClick={() => scrollBy(-1)} aria-label="Scroll left">‹</button>}
      <div className="spread-scroll" ref={ref}>
        <div className="spread-grid">
          {quotes.map(q => <SpreadCard key={q.id} q={q} onToggleStar={onToggleStar} starBusy={starBusy} onOpen={onOpen} onViewPdf={onViewPdf} onDelete={onDelete} onDuplicate={onDuplicate} onGenerateContract={onGenerateContract} onExecutedCopy={onExecutedCopy} onRevisionForm={onRevisionForm} onReceipt={onReceipt} onColorSheet={onColorSheet} />)}
        </div>
      </div>
      {many && <button className="spread-arrow right" onClick={() => scrollBy(1)} aria-label="Scroll right">›</button>}
    </div>
  )
}

function SpreadCard({ q, onToggleStar, starBusy, onOpen, onViewPdf, onDelete, onDuplicate, onGenerateContract, onExecutedCopy, onRevisionForm, onReceipt, onColorSheet }) {
  const thumb = q.payload_json?.rendering_thumb || null
  const canContract = !!(q.payload_json && (q.payload_json.fields || q.payload_json.source === '3d-builder'))
  return (
    <div className={`spread-card${q.starred === true ? ' is-starred' : ''}`} onClick={(e) => { if (e.target.closest('button')) return; onOpen(q) }}>
      {thumb && <div className="q-thumb"><img src={thumb} alt="3D rendering" /></div>}
      <div className="q-head">
        <div>
          <div className="q-id">{q.quote_number ? '#' + q.quote_number : 'QUOTE'}
            <ReplacedBadge quote={q} />
            <StarBadge quote={q} />
          </div>
          <div className="q-size" style={{ fontSize: 24 }}>{q.building_size || '—'}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="q-badge">{formatDate(q.quote_date)}</span>
          <StarButton quote={q} onToggle={onToggleStar} busy={starBusy} />
        </div>
      </div>
      {q.building_summary && <div className="q-sub">{q.building_summary}</div>}
      <div className="q-figures">
        <div className="q-fig"><div className="l">Deposit</div><div className="n num">{money(q.deposit_amount) || '—'}</div></div>
        <div className="q-fig"><div className="l">Balance</div><div className="n num">{money(q.balance_amount) || '—'}</div></div>
      </div>
      <div className="q-divider" />
      <div className="q-total"><div className="l">Total</div><div className="v num">{money(q.total_amount) || '—'}</div></div>
      <div className="q-actions">
        {onDuplicate && <button className="btn btn-ghost" onClick={() => onDuplicate(q)}>Duplicate</button>}
        <button className="btn btn-primary" onClick={() => onOpen(q)}>Open / Edit</button>
        <button className="btn btn-ghost" data-menu-anchor onClick={(e) => openMenu(e.currentTarget, 'Documents', [
          ...(q.pdf_snapshot_url ? [{ id: 'pdf', label: 'View PDF', onClick: () => onViewPdf(q.pdf_snapshot_url) }] : []),
          ...(onGenerateContract && canContract ? [{ id: 'contract', label: 'Generate Contract', onClick: () => onGenerateContract(q) }] : []),
          ...(onExecutedCopy && canContract ? [{ id: 'exec', label: 'Executed Copy — Deposit Paid', onClick: () => onExecutedCopy(q) }] : []),
          ...(onReceipt ? [{ id: 'receipt', label: q.manufacturer === 'cci' ? 'Bill of Sale' : 'Receipt', onClick: () => onReceipt(q) }] : []),
          ...(onColorSheet ? [{ id: 'colors', label: 'Color Sheet', onClick: () => onColorSheet(q) }] : []),
          ...(onRevisionForm ? [{ id: 'revision', label: 'Revision Order', onClick: () => onRevisionForm(q) }] : []),
        ])}>Documents ▾</button>
        {onDelete && <button className="btn btn-ghost" aria-label="Delete quote" title="Delete quote" onClick={() => onDelete(q)} style={{ color: 'var(--danger)' }}>✕</button>}
      </div>
    </div>
  )
}
