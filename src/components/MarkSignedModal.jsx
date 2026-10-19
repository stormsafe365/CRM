// MarkSignedModal — "this file is what the customer signed" (owner 10/19/26: "there is no way to mark
// the contract thats signed i just uploaded as like Executed Contract" / "his actual contract it was
// from 9/24/2026 not October 13th" / "his quote number on the contract he signed was SS-2026-02861").
//   mode 'mark': a Contracts file → which order / revision it is + the day the customer signed + the
//                contract number on the signed paper (+ an optional DEPOSIT PAID copy). The quote is
//                marked signed (lib/contractDocs markExecuted): Deposit Paid unless already further
//                along, the star, the signed day + number the revised contracts print.
//   mode 'date': change the signed day / contract number of a quote already marked signed (createMark:
//                a quote never marked gets a mark with just that day + number).
// The number on the paper: a root's number reaches the revisions already made on it
// (propagateAgreementNumber); a revision's number must carry its own "Rev n".
// Nothing is deleted or renamed; the DEPOSIT PAID copy is a NEW file beside the signed one.

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'
import { getDocSignedUrl, uploadClientDocBlob } from '../lib/storage'
import { stampExecutedPdf } from '../lib/stampExecuted'
import {
  agreementRootOf, cleanContractNumber, cleanDay, contractNumberFor, contractRoleOf, executedOf, parseContractLabel, revOf, stripRev, executedToast, fmtShortDate, isStampedCopy, localDay, markExecuted,
  propagateAgreementNumber, revisionLabel, setSignedDay, signedDayConfirmed, signedNumberOf, signedOnOf, signedPickList,
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
/** this quote's own revision number (0 = an original — also a root whose contract was re-sent in place as "Rev n") */
const revNoOfQuote = (q) => Number(q?.payload_json?.revisionOf?.rev_no) || 0

/** The contract number to offer, as a real number or '' (an unparseable quote number starts the box empty). */
function numberFor(q, file, createNumber) {
  if (!q) return cleanContractNumber(createNumber) || ''
  const pn = file ? parseContractLabel(file.label) : null
  if (pn && stripRev(pn.number) === agreementRootOf(q)) return pn.number
  return cleanContractNumber(signedNumberOf(q) || contractNumberFor(q) || createNumber) || ''
}

export default function MarkSignedModal({ mode = 'mark', clientId, file = null, quotes = [], presetQuoteId = null, justUploaded = false, createMark = false, createNumber = null, intro = null, onClose, onDone }) {
  const { match, list } = useMemo(() => signedPickList(quotes, file?.label || ''), [quotes, file])
  const [qid, setQid] = useState(presetQuoteId || match?.id || '')
  const q = list.find((x) => x.id === qid) || (presetQuoteId ? quotes.find((x) => x.id === presetQuoteId) : null) || null
  const startDay = (x) => (x && executedOf(x) && signedDayConfirmed(x) ? signedOnOf(x) : '')
  const [day, setDay] = useState(startDay(q))
  const [num, setNum] = useState(() => (mode === 'date' && createNumber ? (cleanContractNumber(createNumber) || '') : numberFor(q, file, createNumber)))
  const stampedAlready = !!(q && executedOf(q)?.stampedPath)
  const fileIsStamped = !!(file && isStampedCopy(file.label))
  const [stamp, setStamp] = useState(mode === 'mark' && !fileIsStamped && !stampedAlready)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const dayRef = useRef(null)
  const today = localDay()

  // a different order picked: its own signed day / number (when set) + the stamp default
  useEffect(() => {
    if (mode !== 'mark') return
    setDay(startDay(q))
    setNum(numberFor(q, file, createNumber))
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
  const qRev = revNoOfQuote(q)
  // the typed number, as it will be stored: a revision's number carries ITS "Rev n"
  const typed = cleanContractNumber(num)
  const cn = typed && qRev && !revOf(typed) ? `${typed} ${revisionLabel(qRev)}` : typed
  const numTyped = String(num || '').trim() !== ''
  const numBad = numTyped && !typed
  const revMismatch = !!(typed && qRev && revOf(typed) && Number(revOf(typed)) !== qRev)
  const replacesFile = mode === 'mark' && q && executedOf(q)?.filePath && file && executedOf(q).filePath !== file.path && !fileIsStamped
  // a confirmed signed day / number about to change (the same quote row signed again, or a typo fixed)
  const oldDay = q && executedOf(q) && signedDayConfirmed(q) ? signedOnOf(q) : null
  const changesDay = !!(oldDay && d && d !== oldDay)
  const oldNum = q && executedOf(q) ? signedNumberOf(q) : null
  const changesNum = !!(oldNum && cn && cn !== oldNum)
  // the number on the paper differs from the number this quote's contract was generated under
  const genNum = q ? contractNumberFor(q) : null
  const otherNum = !!(cn && genNum && cn !== genNum && !(oldNum && cn === oldNum))
  const ready = !!q && !!d && !future && !numBad && !revMismatch && !busy

  async function save() {
    if (!ready) {
      setErr(!q ? 'Pick which order this is.' : !d ? 'Pick the date the customer signed.' : future ? 'That date is in the future.'
        : numBad ? 'The contract number looks wrong — it reads like SS-2026-00000 (or SS-2026-00000 Rev 1).'
        : revMismatch ? `This order is Revision ${qRev}: the number must end in Rev ${qRev} (or leave the Rev off and it is added).` : '')
      return
    }
    setBusy(true); setErr('')
    try {
      const isRoot = !qRev && !q.payload_json?.revisionOf
      if (mode === 'date') {
        await setSignedDay(supabase, q.id, d, { create: createMark, number: createNumber, setNumber: cn || null })
        if (cn && isRoot && cn !== oldNum) { try { await propagateAgreementNumber(supabase, q.id, cn) } catch (e) { console.warn('agreement number not passed down', e) } }
        toast(`#${esc(q.quote_number || '')} · signed ${fmtShortDate(d)}${cn ? ' · contract ' + esc(cn) : ''}`, 'success')
        onDone?.({ quoteId: q.id, day: d, number: cn || null })
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
      // the contract number this signature is for: typed (the number on the paper), else the file's / the quote's
      const number = cn || numberFor(q, file, null) || contractNumberFor(q)
      const opts = { signedOn: d, number }
      if (!fileIsStamped) { opts.filePath = file.path; opts.file = file.label }
      if (stampedPath) opts.stampedPath = stampedPath
      const r = await markExecuted(supabase, q.id, opts)
      if (number && isRoot && number !== genNum) { try { await propagateAgreementNumber(supabase, q.id, number) } catch (e) { console.warn('agreement number not passed down', e) } }
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
        {intro && <p className="msign-help" style={{ marginTop: 0 }}>{intro}</p>}

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
        <p className="msign-help">The date on the signed contract (not today, unless he signed today).</p>

        <div className="msign-q">Contract # on the signed paper</div>
        <input type="text" className="msign-num" value={num} placeholder={qRev ? `SS-2026-00000 Rev ${qRev}` : 'SS-2026-00000'} spellCheck={false} onChange={(e) => setNum(e.target.value)} />
        <p className="msign-help">As printed on the contract he signed.{qRev ? ` This order is Revision ${qRev}, so it ends in Rev ${qRev}.` : ''} Revised contracts say “Revision 1 to Agreement {cn ? stripRev(cn) : '…'}, signed {d ? fmtShortDate(d) : 'MM/DD/YYYY'}”.</p>
        {otherNum && !revMismatch && !qRev && <p className="msign-note">This order's contract was generated as {genNum}; the paper says {cn}. That's fine — the revised contracts will use {stripRev(cn)}.</p>}
        {otherNum && !revMismatch && qRev > 0 && <p className="msign-note">This revision's contract was generated as {genNum}; the paper says {cn}. The agreement's number comes from the original contract's mark — set it there (Contracts › Actions › Change the signed date / contract #) if it differs.</p>}
        {revMismatch && <p className="msign-err">This order is Revision {qRev}: the number must end in Rev {qRev}.</p>}

        {mode === 'mark' && !fileIsStamped && (
          <label className="msign-chk">
            <input type="checkbox" checked={stamp} onChange={(e) => setStamp(e.target.checked)} />
            <span>Also make the DEPOSIT PAID copy (logo + watermark over these signed pages — the bill of sale){stampedAlready ? ' · this order already has one' : ''}</span>
          </label>
        )}
        {changesDay && <p className="msign-warn">This changes the signed date of {quoteLine(q)} from {fmtShortDate(oldDay)} to {fmtShortDate(d)}.</p>}
        {changesNum && <p className="msign-warn">This changes the contract number of {quoteLine(q)} from {oldNum} to {cn}.</p>}
        {replacesFile && <p className="msign-warn">This order already has a signed copy linked. This file becomes its signed copy; the other one stays in Documents.</p>}
        {err && <p className="msign-err">{err}</p>}

        <div className="msign-btns">
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => onClose?.()}>{justUploaded ? 'Not signed — just keep the file' : 'Cancel'}</button>
          <button type="button" className="btn-primary" disabled={busy} onClick={save} style={{ fontWeight: 800 }}>
            {busy ? 'Saving…' : mode === 'date' ? 'Save' : 'Mark signed'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
