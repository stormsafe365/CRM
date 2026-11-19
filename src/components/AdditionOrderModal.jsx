// AdditionOrderModal: make an ADDITION ORDER for a building the customer already has (Doc Hub › a signed contract ›
// Actions › Make an addition order…). Owner 11/19/26: "is there a way to make one of these for people moving forward
// through our crm ?" - after Robert Andrews' door-only order for CCI (SS-2026-79957-A). Filled in from the quote it adds
// to (customer, jobsite, county, manufacturer, the agreement's number); the rep picks what is added and where.
// Prices come from the quote program (lib/revisionPricing loadPriceEngine → MANUFACTURERS / COUNTY_TAX) - nothing is
// typed except an "Other" line, which says so. Generate renders the order in the contract's look (lib/additionHtml),
// saves the PDF to Documents › Contracts and records it on the quote (payload_json.additions) so it can be marked signed.
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { loadPriceEngine } from '../lib/revisionPricing'
import { renderQuotePdf } from '../lib/builderSave'
import { uploadClientDocBlob } from '../lib/storage'
import { supabase } from '../lib/supabase'
import { toast } from '../lib/uiFx'
import { usd } from '../lib/money'
import { localDay, fmtShortDate } from '../lib/contractDocs'
import {
  ADDITION_FEE, KINDS, PAY_METHODS, WALLS, additionCatalog, additionDefaults, additionFileName, additionRecord, addsInWords,
  impactRuleFor, newItem, nextAdditionNumber, priceAddition, saveAdditionPayload, withAddition,
} from '../lib/additionOrder'

const FIELD = {
  width: '100%', boxSizing: 'border-box', background: 'var(--inset, #0B1B32)', color: 'var(--fg, #e2e8f0)',
  border: '1px solid var(--line, #294059)', borderRadius: 8, padding: '8px 10px', fontSize: 13.5,
}
const LBL = { display: 'block', fontSize: 11.5, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--fg-3, #8598AC)', margin: '12px 0 4px' }
const NOTE = { margin: '4px 0 0', fontSize: 12, color: 'var(--fg-3, #8598AC)', lineHeight: 1.45 }
const MFR_LABEL = { CCI: 'CCI', CA: 'CA' }
const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])) // toast() renders HTML

export default function AdditionOrderModal({ client, quote, quotes = [], fileLabels = [], userId = null, onClose, onDone }) {
  const [pg, setPg] = useState(null)
  const [loadErr, setLoadErr] = useState('')
  useEffect(() => {
    let dead = false
    loadPriceEngine(quote?.manufacturer)
      .then((w) => { if (!dead) setPg(w) })
      .catch((e) => { if (!dead) setLoadErr(e.message || 'The prices did not load.') })
    return () => { dead = true }
  }, [quote?.manufacturer])

  // what the order starts with (the program's county tax table once it is loaded)
  const d = useMemo(() => {
    let countyTax = null
    try { countyTax = pg && pg.COUNTY_TAX } catch { /* the saved rate below */ }
    return additionDefaults(quote, client, { countyTax })
  }, [quote, client, pg])
  const rule = useMemo(() => impactRuleFor(d.mfr, d.county, d.sqft), [d])
  const catalog = useMemo(() => {
    if (!pg) return null
    let mdef = null
    try { mdef = pg.MANUFACTURERS && pg.MANUFACTURERS[d.mfr] } catch { /* none */ }
    return mdef ? additionCatalog(mdef, rule) : null
  }, [pg, d.mfr, rule])

  const [items, setItems] = useState(null)
  useEffect(() => { if (catalog && !items) setItems([newItem(catalog, 'wtd')]) }, [catalog, items])
  const [taxPct, setTaxPct] = useState(null)
  useEffect(() => { if (pg && taxPct === null) setTaxPct(String(d.taxPct)) }, [pg, d.taxPct, taxPct])
  const [fee, setFee] = useState(d.fee != null ? String(d.fee) : '')
  const [waived, setWaived] = useState(false)
  const [payMethod, setPayMethod] = useState(d.payMethod)
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState('')

  const today = localDay()
  const num = useMemo(() => (d.root ? nextAdditionNumber(d.root, quotes, fileLabels) : null), [d.root, quotes, fileLabels])
  const money = useMemo(() => (catalog && items ? priceAddition({ items, catalog, taxPct: Number(taxPct) || 0, fee: Number(fee) || 0, waived }) : null), [catalog, items, taxPct, fee, waived])
  const feeMissing = String(fee).trim() === '' || !Number.isFinite(Number(fee)) || Number(fee) < 0
  const taxBad = taxPct !== null && (String(taxPct).trim() === '' || !Number.isFinite(Number(taxPct)) || Number(taxPct) < 0 || Number(taxPct) > 15)
  const why = !d.root ? 'This quote has no number to add to.'
    : !num ? 'This agreement already has 26 addition orders.'
      : money && !money.ok ? money.why
        : feeMissing ? (d.mfr === 'CA' ? "Type CA's fee for the addition (0 if none)." : 'Type the addition fee (0 if none).')
          : taxBad ? 'Check the sales tax %.' : ''

  const setItem = (i, patch) => setItems((l) => l.map((it, k) => (k === i ? { ...it, ...patch } : it)))
  const setKind = (i, kind) => setItems((l) => l.map((it, k) => (k === i ? { ...newItem(catalog, kind), wall: it.wall, qty: it.qty } : it)))

  async function generate() {
    if (why || !money || busy) return
    setBusy('Checking the number…')
    try {
      // the lead's additions as they are NOW (another rep may have just made one): the letter is taken from them
      let fresh = quotes
      try {
        const { data } = await supabase.from('quotes').select('id, payload_json, deleted_at').eq('client_id', client.id)
        if (Array.isArray(data)) fresh = data
      } catch { /* the list we have */ }
      const n = nextAdditionNumber(d.root, fresh, fileLabels)
      if (!n) throw new Error('This agreement already has 26 addition orders.')
      setBusy('Rendering…')
      const [{ buildAdditionHtml }, parts] = await Promise.all([import('../lib/additionHtml'), import('../lib/contractParts.generated')])
      const html = buildAdditionHtml(parts, { number: n.number, date: today, d, money, items, payMethod, notes, addsInWords: addsInWords(money.lines) })
      const blob = await renderQuotePdf(html)
      setBusy('Saving…')
      const path = await uploadClientDocBlob(client.id, 'contract', blob, additionFileName(d.name, n.number, today), 'application/pdf')
      const rec = additionRecord({ number: n.number, date: today, d, money, items, notes, payMethod, filePath: path, by: userId })
      let recorded = true
      try { await saveAdditionPayload(supabase, quote.id, (p) => withAddition(p, rec, { create: true })) } catch (e) { recorded = false; console.warn('addition not recorded on the quote', e) }
      window.dispatchEvent(new CustomEvent('ss:docs-updated', { detail: { clientId: client.id } }))
      try { window.open(URL.createObjectURL(blob), '_blank') } catch { /* ignore */ }
      toast(recorded
        ? `Addition order ${escHtml(n.number)} saved · Documents › Contracts`
        : `Addition order ${escHtml(n.number)} saved to Documents › Contracts, but it could not be linked to the quote — tell Claude.`,
      recorded ? 'success' : undefined)
      setBusy('')
      onDone && onDone()
    } catch (e) {
      setBusy('')
      toast(escHtml(e.message || 'Could not make the addition order.'))
    }
  }

  const ruleNote = rule.doors
    ? `${d.county} (CCI): walk-in doors must be High-Wind rated and windows Hi-Impact — the same lock as the quote program.`
    : rule.windows ? `${d.county} (CCI): windows must be Hi-Impact — the same lock as the quote program.`
      : d.mfr === 'CCI' && !d.county ? 'No county on this order — check whether its county needs High-Wind walk-in doors / Hi-Impact windows (CCI impact counties) before you pick.' : ''
  const feeLabel = d.mfr === 'CCI' ? 'Addition delivery fee — not taxed ($)' : 'Addition fee — not taxed ($)'

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="Addition order" className="msign-scrim"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose() }}>
      <div className="msign addo">
        <h2>Addition order {num ? <span className="addo-num">{num.number}</span> : null}</h2>
        <p className="addo-sub">
          {d.name || client?.name || 'Customer'} · adds to <b>#{d.root || '—'}</b>{d.building ? ` (${d.building})` : ''}
          {d.origSigned ? ` · signed ${fmtShortDate(d.origSigned)}` : ''} · {MFR_LABEL[d.mfr]}{d.county ? ` · ${d.county}` : ''} · dated today
        </p>
        <p style={NOTE}>For something added to a building that is already up. A building that is not installed yet gets a revision of its contract instead.</p>

        {loadErr ? <div className="error-banner" style={{ marginTop: 12 }}>{loadErr} Close this and try again.</div>
          : !catalog || !items ? <p style={{ ...NOTE, marginTop: 14 }}>Loading the prices from the quote program…</p>
            : (
              <>
                <label style={LBL}>What is being added</label>
                {ruleNote && <p className="addo-rule">{ruleNote}</p>}
                <div className="addo-items">
                  {items.map((it, i) => {
                    const line = money.lines[i]
                    const list = it.kind === 'other' ? [] : catalog[it.kind] || []
                    return (
                      <div key={i} className="addo-item">
                        <div className="addo-row">
                          <select style={{ ...FIELD, width: 132 }} value={it.kind} onChange={(e) => setKind(i, e.target.value)} aria-label="Kind">
                            {KINDS.map((k) => <option key={k.v} value={k.v}>{k.label}</option>)}
                          </select>
                          {it.kind === 'other'
                            ? <input className="addo-model" style={{ ...FIELD, flex: 1, minWidth: 0 }} value={it.desc} placeholder="What it is (prints on the order)" onChange={(e) => setItem(i, { desc: e.target.value })} />
                            : (
                              <select className="addo-model" style={{ ...FIELD, flex: 1, minWidth: 0 }} value={it.type} onChange={(e) => setItem(i, { type: e.target.value })} aria-label="Model">
                                {list.map((t) => <option key={t.v} value={t.v} disabled={t.locked}>{t.label} — {usd(t.price)}{t.locked ? ` (not allowed in ${d.county})` : ''}</option>)}
                              </select>
                            )}
                          <input style={{ ...FIELD, width: 58 }} type="number" min="1" step="1" value={it.qty} aria-label="How many"
                            onChange={(e) => setItem(i, { qty: e.target.value })} />
                          <button type="button" className="addo-x" title="Remove this item" aria-label="Remove this item" disabled={items.length === 1}
                            onClick={() => setItems((l) => l.filter((_, k) => k !== i))}>✕</button>
                        </div>
                        <div className="addo-row addo-row2">
                          <select style={{ ...FIELD, width: 170 }} value={it.wall} onChange={(e) => setItem(i, { wall: e.target.value })} aria-label="Where">
                            <option value="">Where? (optional)</option>
                            {WALLS.map((w) => <option key={w} value={w}>{w}</option>)}
                          </select>
                          {it.kind === 'wtd' && (
                            <label className="addo-check">
                              <input type="checkbox" checked={!!it.framed} onChange={(e) => setItem(i, { framed: e.target.checked })} />
                              Into the framed opening that is already there
                            </label>
                          )}
                          {it.kind === 'other' && (
                            <input style={{ ...FIELD, width: 120 }} type="number" min="0" step="0.01" value={it.price} placeholder="Price each $"
                              onChange={(e) => setItem(i, { price: e.target.value })} />
                          )}
                          <span className="addo-amt">{line && line.amount ? usd(line.amount) : '—'}</span>
                        </div>
                        {it.kind === 'other' && <p style={{ ...NOTE, marginTop: 2 }}>You type this price — it is not from the quote program.</p>}
                      </div>
                    )
                  })}
                </div>
                <button type="button" className="addo-add" onClick={() => setItems((l) => [...l, newItem(catalog, 'wtd')])}>+ Add another item</button>

                <div className="addo-two">
                  <div>
                    <label style={LBL}>{feeLabel}</label>
                    <input style={FIELD} type="number" min="0" step="0.01" value={fee} placeholder={d.mfr === 'CA' ? 'Ask CA' : '0.00'} onChange={(e) => setFee(e.target.value)} />
                    <p style={NOTE}>{(ADDITION_FEE[d.mfr] || ADDITION_FEE.CCI).note}</p>
                  </div>
                  <div>
                    <label style={LBL}>Sales tax (%)</label>
                    <input style={FIELD} type="number" min="0" step="0.1" value={taxPct ?? ''} onChange={(e) => setTaxPct(e.target.value)} />
                    <p style={NOTE}>{d.agx ? 'The original order was agricultural exempt.' : d.county ? `${d.county} County rate from the quote program.` : 'No county on the quote — check the rate.'}</p>
                  </div>
                </div>

                <div className="addo-two">
                  <div>
                    <label style={LBL}>Deposit ({money.depPct}% of the items)</label>
                    <label className="addo-check" style={{ marginTop: 6 }}>
                      <input type="checkbox" checked={waived} onChange={(e) => setWaived(e.target.checked)} />
                      Waive the deposit
                    </label>
                  </div>
                  {!waived && (
                    <div>
                      <label style={LBL}>Payment method (deposit)</label>
                      <select style={FIELD} value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
                        {PAY_METHODS.map((m) => <option key={m}>{m}</option>)}
                      </select>
                    </div>
                  )}
                </div>

                <label style={LBL}>Notes (print on the order)</label>
                <textarea style={{ ...FIELD, minHeight: 54, resize: 'vertical' }} value={notes} placeholder="Optional — e.g. no window in the door"
                  onChange={(e) => setNotes(e.target.value)} />

                <div className="addo-tot">
                  <div><span>Items</span><b>{usd(money.sub) || '$0'}</b></div>
                  <div><span>Sales tax ({money.taxPct}%)</span><b>{usd(money.tax) || '$0'}</b></div>
                  {money.fee > 0 && <div><span>{d.mfr === 'CCI' ? 'Addition delivery fee' : 'Addition fee'}</span><b>{usd(money.fee)}</b></div>}
                  <div className="g"><span>Grand total</span><b>{usd(money.total) || '$0'}</b></div>
                  <div><span>Deposit</span><b className={waived ? 'ok' : ''}>{waived ? 'WAIVED' : usd(money.deposit) || '$0'}</b></div>
                  <div><span>Balance at scheduling</span><b>{usd(money.balance) || '$0'}</b></div>
                </div>
                {why && <p className="addo-why">{why}</p>}
              </>
            )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button className="btn-secondary" disabled={!!busy} onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={!!busy || !!why || !money} onClick={generate} style={{ fontWeight: 800 }}>
            {busy || 'Generate addition order'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
