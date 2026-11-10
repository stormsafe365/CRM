// ReceiptModal: generate a branded payment receipt for a quote/order.
// Prefills from the quote (deposit amount, totals) — the rep confirms amount,
// method and what the payment applies to, then Generate renders the receipt
// (lib/receiptHtml) to PDF via the shared Electron print path, saves it to the
// client's Document Hub (Additional), and opens it for immediate sending.

import { useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { uploadClientDocBlob } from '../lib/storage'
import { renderQuotePdf } from '../lib/builderSave'
import { buildReceiptHtml, makeReceiptNumber, orderTotalOf } from '../lib/receiptHtml'
import { toast } from '../lib/uiFx'
import { usd } from '../lib/money'
import { receiptFreightOf } from '../lib/cardFreight'

const METHODS = ['Credit / Debit Card', 'Check', 'Cash', 'ACH / Bank Transfer', 'Wire Transfer', 'Financing', 'Other']
const APPLIED = ['Deposit', 'Progress Payment', 'Final Balance', 'Paid in Full']

const FIELD = {
  width: '100%', boxSizing: 'border-box',
  background: 'var(--inset, #0B1B32)', color: 'var(--fg, #e2e8f0)',
  border: '1px solid var(--line, #294059)', borderRadius: 8,
  padding: '9px 11px', fontSize: 13.5,
}
const LBL = { display: 'block', fontSize: 11.5, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--fg-3, #8598AC)', margin: '10px 0 4px' }

const isoToday = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function ReceiptModal({ client, quote, onClose }) {
  // Order total (= the contract's Grand Total): the card's total_amount, else the grand total saved with the quote
  // (orderTotalOf) - a contract / copy card can lack total_amount (Laura Rincon SS-2026-01418 printed "Order Total $0.00",
  // owner 11/9/26: "its not lining up"). Editable; the remaining balance follows it.
  const totInfo = useMemo(() => orderTotalOf(quote), [quote])
  const [orderTotal, setOrderTotal] = useState(totInfo.total != null ? String(totInfo.total) : '')
  const total = Number(orderTotal) || 0
  // CCI orders generate a Carolina Carports BILL OF SALE (seller = CCI,
  // StormSafe = authorized dealer); everything else is a StormSafe receipt.
  const isCCI = String(quote?.manufacturer || '').toLowerCase() === 'cci'
  const docLabel = isCCI ? 'Bill of Sale' : 'Payment Receipt'
  const [form, setForm] = useState({
    // the card's deposit, else the deposit saved with the quote's price (the contract's "Deposit due now"), editable
    amount: quote?.deposit_amount != null ? String(quote.deposit_amount)
      : (Number(quote?.payload_json?.priced?.money?.dep) > 0 ? String(quote.payload_json.priced.money.dep) : ''),
    date: isoToday(),
    method: METHODS[0],
    reference: '',
    appliedTo: 'Deposit',
    remaining: '',
    note: '',
  })
  // Remaining auto-tracks total − amount until the rep types their own number
  // (earlier payments may already be in — the math can't know that).
  // CCI orders: name Carolina Carports on the bill of sale? Owner 11/9/26: "Its our bill of sale for the deposit, i dont
  // think its necessary ... it should give the option - list manufacturer - yes/no" -> default No (StormSafe's own).
  const [listMfr, setListMfr] = useState(false)
  // CCI freight (3%, not taxed, due at installation - its own charge, never in total_amount). Owner 11/9/26: "What about
  // the freight fee???" receiptFreightOf: the amount saved with the quote (= its card / contract), else - a quote saved
  // before freight was its own charge (Laura Rincon) - the program's rule on its saved building price before discounts.
  // Every CCI quote shows the field, editable (0 = already paid / waived; type it from the contract if it is empty).
  const frtInfo = useMemo(() => receiptFreightOf(quote), [quote])
  const [freight, setFreight] = useState(frtInfo.freight > 0 ? String(frtInfo.freight) : '')
  const remTouched = useRef(false)
  const autoRemaining = useMemo(() => {
    const amt = Number(form.amount)
    if (!total || !isFinite(amt)) return ''
    return String(Math.max(0, Math.round((total - amt) * 100) / 100))
  }, [form.amount, total])
  const remaining = remTouched.current ? form.remaining : autoRemaining

  const [busy, setBusy] = useState('')

  async function generate() {
    const amt = Number(form.amount)
    if (!isFinite(amt) || amt <= 0) { toast('Enter the payment amount first.'); return }
    setBusy('Rendering…')
    try {
      const number = makeReceiptNumber(quote)
      const html = buildReceiptHtml({
        client,
        quote,
        receipt: {
          number,
          date: form.date,
          amount: amt,
          method: form.method,
          reference: form.reference.trim(),
          appliedTo: form.appliedTo,
          remaining: Number(remaining) || 0,
          note: form.note.trim(),
          listMfr: isCCI && listMfr,
          freight: Math.max(0, Number(freight) || 0),
          orderTotal: total > 0 ? total : null,
        },
      })
      const blob = await renderQuotePdf(html)
      setBusy('Saving…')
      let saved = true
      try {
        await uploadClientDocBlob(client.id, 'additional', blob, `${number}.pdf`, 'application/pdf')
        window.dispatchEvent(new CustomEvent('ss:docs-updated', { detail: { clientId: client.id } }))
      } catch (e) { saved = false; console.warn('receipt upload failed', e) }
      // Open the finished receipt right away so it can be printed / attached.
      try { window.open(URL.createObjectURL(blob), '_blank') } catch { /* ignore */ }
      toast(saved
        ? `${docLabel} ${number} saved to ${client.name || 'lead'} · Documents › Additional`
        : `${docLabel} generated (opened in a new window) — but saving to Documents failed.`,
      saved ? 'success' : undefined)
      setBusy('')
      onClose()
    } catch (e) {
      setBusy('')
      toast(e.message || 'Could not generate the receipt.')
    }
  }

  return createPortal(
    <div
      role="dialog" aria-modal="true" aria-label={docLabel}
      style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(4,9,16,.62)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose() }}
    >
      <div style={{
        width: 'min(440px, calc(100vw - 32px))', maxHeight: 'calc(100vh - 64px)', overflow: 'auto',
        background: 'var(--card, #0D1929)', border: '1px solid var(--line, #294059)',
        borderRadius: 14, padding: 18, boxShadow: '0 18px 60px rgba(0,0,0,.5)',
      }}>
        <h2 style={{ margin: '2px 0 4px', fontSize: 17 }}>{docLabel}</h2>
        <p style={{ margin: '0 0 6px', color: 'var(--fg-3, #8598AC)', fontSize: 13 }}>
          {client?.name || 'Client'}{quote?.quote_number ? ` · Quote #${quote.quote_number}` : ''}{total ? ` · Total ${usd(total)}` : ''}
          {isCCI && listMfr ? ' · Seller: Carolina Carports, Inc.' : ''}
        </p>

        {isCCI && (
          <>
            <label style={LBL}>List manufacturer on the bill of sale</label>
            <select style={FIELD} value={listMfr ? 'yes' : 'no'} onChange={(e) => setListMfr(e.target.value === 'yes')}>
              <option value="no">No — StormSafe Steel only</option>
              <option value="yes">Yes — name Carolina Carports, Inc. (seller / manufacturer)</option>
            </select>
          </>
        )}

        <label style={LBL}>Order Total — the contract&apos;s Grand Total ($)</label>
        <input style={FIELD} type="number" min="0" step="0.01" value={orderTotal} placeholder="0.00"
          onChange={(e) => setOrderTotal(e.target.value)} />
        {totInfo.source !== 'card' && (
          <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--fg-3, #8598AC)' }}>
            {totInfo.source === 'saved-price'
              ? 'Not on this card — taken from the price saved with the quote. Check it matches the contract.'
              : 'Not saved on this card — type the Grand Total from the contract.'}
          </p>
        )}

        <label style={LBL}>Amount Received ($) *</label>
        <input style={FIELD} type="number" min="0" step="0.01" value={form.amount} autoFocus
          onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0.00" />

        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <label style={LBL}>Payment Date</label>
            <input style={FIELD} type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={LBL}>Applied To</label>
            <select style={FIELD} value={form.appliedTo} onChange={(e) => setForm({ ...form, appliedTo: e.target.value })}>
              {APPLIED.map((a) => <option key={a}>{a}</option>)}
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <label style={LBL}>Payment Method</label>
            <select style={FIELD} value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
              {METHODS.map((m) => <option key={m}>{m}</option>)}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label style={LBL}>Reference / Check #</label>
            <input style={FIELD} value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder="Optional" />
          </div>
        </div>

        <label style={LBL}>Remaining Balance After This Payment ($)</label>
        <input style={FIELD} type="number" min="0" step="0.01" value={remaining}
          onChange={(e) => { remTouched.current = true; setForm({ ...form, remaining: e.target.value }) }} />
        {!remTouched.current && total > 0 && (
          <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--fg-3, #8598AC)' }}>
            Auto-calculated from the quote total — edit if earlier payments were already made.
          </p>
        )}

        {(isCCI || frtInfo.freight > 0) && (
          <>
            <label style={LBL}>Freight — 3%, due at installation ($)</label>
            <input style={FIELD} type="number" min="0" step="0.01" value={freight} placeholder="0.00"
              onChange={(e) => setFreight(e.target.value)} />
            <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--fg-3, #8598AC)' }}>
              {frtInfo.source === 'saved'
                ? 'From the quote (not taxed, not in the deposit). Shows under the remaining balance with the total still due — set 0 if already paid.'
                : frtInfo.source === 'estimate'
                  ? `Not saved with this older quote — 3% of its building price before discounts (${usd(frtInfo.sub)}). Check it matches the contract; set 0 if already paid.`
                  : 'No freight on this quote — type it from the contract if there is one.'}
            </p>
          </>
        )}

        <label style={LBL}>Note (shows on the receipt)</label>
        <input style={FIELD} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Optional — e.g. Balance due at scheduling" />

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button className="btn-secondary" disabled={!!busy} onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={!!busy} onClick={generate} style={{ fontWeight: 800 }}>
            {busy || `Generate ${docLabel}`}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
