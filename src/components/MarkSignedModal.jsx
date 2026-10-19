// MarkSignedModal — "this file is what the customer signed" (owner 10/19/26: "there is no way to mark
// the contract thats signed i just uploaded as like Executed Contract" / "his actual contract it was
// from 9/24/2026 not October 13th").
//   mode 'mark': a Contracts file → which order / revision it is + the day the customer signed (+ an
//                optional DEPOSIT PAID copy). The quote is marked signed (lib/contractDocs markExecuted):
//                Deposit Paid unless already further along, the star, the signed day the revised
//                contracts print.
//   mode 'date': change the signed day of a quote already marked signed.
// Nothing is deleted or renamed; the DEPOSIT PAID copy is a NEW file beside the signed one.

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'
import { getDocSignedUrl, uploadClientDocBlob } from '../lib/storage'
import { stampExecutedPdf } from '../lib/stampExecuted'
import {
  agreementRootOf, cleanDay, contractRoleOf, executedOf, executedToast, fmtShortDate, isStampedCopy, localDay, markExecuted,
  setSignedDay, signedDayConfirmed, signedOnOf, signedPickList,
} from '../lib/contractDocs'
import { quoteStatusLabel } from '../lib/constants'
import { toast } from '../lib/uiFx'

const money = (n) => (n == null || n === '' ? '—' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

/** "#SS-2026-50001 · Revision 1 of SS-2026-68012" / "#SS-2026-68012 · Original contract" */
export function quoteLine(q) {
  const role = contractRoleOf(q)
  const agr = agreementRootOf(q)
  return `#${q.quote_number || '—'} · ${role}${role !== 'Original contract' && agr ? ` of ${agr}` : ''}`
}

export default function MarkSignedModal({ mode = 'mark', clientId, file = null, quotes = [], presetQuoteId = null, justUploaded = false, onClose, onDone }) {
  const { match, list } = useMemo(() => signedPickList(quotes, file?.label || ''), [quotes, file])
  const [qid, setQid] = useState(presetQuoteId || match?.id || '')
  const q = list.find((x) => x.id === qid) || (presetQuoteId ? quotes.find((x) => x.id === presetQuoteId) : null) || null
  const startDay = (x) => (x && executedOf(x) && signedDayConfirmed(x) ? signedOnOf(x) : '')
  const [day, setDay] = useState(startDay(q))
  const stampedAlready = !!(q && executedOf(q)?.stampedPath)
  const fileIsStamped = !!(file && isStampedCopy(file.label))
  const [stamp, setStamp] = useState(mode === 'mark' && !fileIsStamped && !stampedAlready)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const dayRef = useRef(null)
  const today = localDay()

  // a different order picked: its own signed day (when set) + the stamp default
  useEffect(() => {
    if (mode !== 'mark') return
    setDay(startDay(q))
    setStamp(!fileIsStamped && !(q && executedOf(q)?.stampedPath))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qid])
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  const d = cleanDay(day)
  const future = d && d > today
  const replacesFile = mode === 'mark' && q && executedOf(q)?.filePath && file && executedOf(q).filePath !== file.path && !fileIsStamped
  const ready = !!q && !!d && !future && !busy

  async function save() {
    if (!ready) { setErr(!q ? 'Pick which order this is.' : !d ? 'Pick the date the customer signed.' : future ? 'That date is in the future.' : ''); return }
    setBusy(true); setErr('')
    try {
      if (mode === 'date') {
        await setSignedDay(supabase, q.id, d)
        toast(`#${esc(q.quote_number || '')} · signed ${fmtShortDate(d)}`, 'success')
        onDone?.({ quoteId: q.id })
        return
      }
      let stampedPath
      if (fileIsStamped) stampedPath = file.path
      else if (stamp) {
        const url = await getDocSignedUrl(file.path)
        const res = await fetch(url)
        if (!res.ok) throw new Error('Could not download the file to make the DEPOSIT PAID copy.')
        const ct = res.headers.get('content-type') || (/\.(png|jpe?g)$/i.test(file.label) ? 'image/jpeg' : 'application/pdf')
        const blob = await stampExecutedPdf(new Uint8Array(await res.arrayBuffer()), ct)
        stampedPath = await uploadClientDocBlob(clientId, 'contract', blob, `${file.label.replace(/\.[^.]+$/, '')}-EXECUTED-deposit-paid.pdf`, 'application/pdf')
      }
      const opts = { signedOn: d }
      if (!fileIsStamped) { opts.filePath = file.path; opts.file = file.label }
      if (stampedPath) opts.stampedPath = stampedPath
      const r = await markExecuted(supabase, q.id, opts)
      toast(esc(executedToast(r, quoteStatusLabel(q.status))), 'success')
      onDone?.({ quoteId: q.id })
    } catch (e) {
      setErr(e.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  const title = mode === 'date' ? 'When did the customer sign?' : 'Mark as signed'
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={title} className="msign-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose?.() }}>
      <div className="msign">
        <h2>{title}</h2>
        {mode === 'mark' && file && <p className="msign-file" title={file.label}>{file.label}</p>}
        {mode === 'date' && q && <p className="msign-file">{quoteLine(q)}</p>}

        {mode === 'mark' && (
          <>
            <div className="msign-q">Which order did the customer sign?</div>
            {list.length === 0 && <p className="msign-help">This lead has no quotes. Save the quote to the lead first.</p>}
            <div role="radiogroup" className="msign-list">
              {list.map((x) => (
                <label key={x.id} className={`msign-opt${x.id === qid ? ' on' : ''}`}>
                  <input type="radio" name="msign-q" checked={x.id === qid} onChange={() => setQid(x.id)} />
                  <span className="msign-opt-main">
                    <b>{quoteLine(x)}</b>
                    <span className="msign-opt-sub">
                      {[x.building_size, quoteStatusLabel(x.status), executedOf(x) ? (signedDayConfirmed(x) ? `signed ${fmtShortDate(signedOnOf(x))}` : 'marked signed · date not set') : null].filter(Boolean).join(' · ')}
                      {match && x.id === match.id ? ' · matches the file name' : ''}
                    </span>
                  </span>
                  <b className="msign-amt">{money(x.total_amount)}</b>
                </label>
              ))}
            </div>
          </>
        )}

        <div className="msign-q">Date the customer signed</div>
        <input ref={dayRef} type="date" className="msign-date" value={day} max={today} onChange={(e) => setDay(e.target.value)} />
        <p className="msign-help">The date on the signed contract (not today, unless he signed today). Revised contracts print it: “Revision 1 to Agreement …, signed {d ? fmtShortDate(d) : 'MM/DD/YYYY'}”.</p>

        {mode === 'mark' && !fileIsStamped && (
          <label className="msign-chk">
            <input type="checkbox" checked={stamp} onChange={(e) => setStamp(e.target.checked)} />
            <span>Also make the DEPOSIT PAID copy (logo + watermark over these signed pages — the bill of sale){stampedAlready ? ' · this order already has one' : ''}</span>
          </label>
        )}
        {replacesFile && <p className="msign-warn">This order already has a signed copy linked. This file becomes its signed copy; the other one stays in Documents.</p>}
        {err && <p className="msign-err">{err}</p>}

        <div className="msign-btns">
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => onClose?.()}>{justUploaded ? 'Not signed — just keep the file' : 'Cancel'}</button>
          <button type="button" className="btn-primary" disabled={!ready} onClick={save} style={{ fontWeight: 800 }}>
            {busy ? 'Saving…' : mode === 'date' ? 'Save the date' : 'Mark signed'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
