// BuildQuoteModal: opens the StormSafe 3D Builder (/build/build.html) full-screen
// for a lead. The builder hosts the QTEPRO pricing program (quote-builder.html)
// in its left pane — the same program the CRM already captures from. So we reach
// into that nested program window and:
//   • relabel its "SAVE QUOTE" button → "Save to Lead", and
//   • route the save to the CRM (capture totals + branded PDF → quotes row).
// A matching "Save to Lead" button in the top bar does the same, as a reliable
// fallback. Pricing/PDF come straight from the program — never re-derived here.
// The bar's "Quote PDF" choice (Dark / White, owner 10/12/26) is the program's
// own quote style, so the saved PDF follows it (QuoteStyleToggle).
//
// Price lock (owner 9/30/26: "make sure i can reopen that quote exactly as it
// was"): a saved quote reopens at its SAVED price — restoreQuoteData(data,
// {lock:true, status, legacyTotals}) and the builder's window.PriceLock hold
// it. The bar under the title shows saved vs today's rules; automatic
// contract / executed copy / revision only run while the saved price is held;
// every write to a saved quote asks first in one dialog (saved → new; it says
// so when nothing changed).
//
// Build quote from a customer design (owner 10/21/26): `fromDesign` = a
// design_requests row. Once the program is loaded it is filled in with the
// customer's building (lib/designToQuote: CCI, today's pricing, never a price
// put in), the lead's contact info goes in as usual, and a "Check these before
// quoting" bar lists what the program could not take exactly as drawn. Nothing
// is saved until the rep saves (Save to Lead creates the quote as usual).
//
// Update Quote ▾ (owner 10/24/26: she tweaked a saved quote and wanted to keep BOTH versions): once a saved quote
// is open the save button is a split button — Update this quote (as before), Save as a new quote (lib/saveAsNew:
// a NEW row for the lead, priced like any new quote at today's pricing, the original row never written; the
// builder then carries on with the new quote), Done — close without saving (asks when something changed).

import { useEffect, useRef, useState } from 'react'
import SaveToLeadPicker from './SaveToLeadPicker'
import SaveSplitButton from './SaveSplitButton'
import { useAuth } from '../context/AuthContext'
import { promoteToWorking } from '../lib/promoteLead'
import {
  buildSignature, finishProgramForNewQuote, prepareProgramForNewQuote, saveAsNewBlocker, saveAsNewConfirm, saveAsNewProblems,
  saveAsNewRow, unsavedCheck, unsavedMessage,
} from '../lib/saveAsNew'
import PriceChangeConfirm from './PriceChangeConfirm'
import MarkSignedModal from './MarkSignedModal'
import QuoteStyleToggle from './QuoteStyleToggle'
import { uploadClientDocBlob } from '../lib/storage'
import { captureContractHtml, quoteNumberFromHtml } from '../lib/quoteCapture'
import { harvestAndSaveQuote, harvestRevisionUpdate, renderQuotePdf, updateQuoteRow } from '../lib/builderSave'
import { toast } from '../lib/uiFx'
import { buildRevisionHtml, makeRevisionOrderNumber } from '../lib/revisionHtml'
import { supabase } from '../lib/supabase'
import { quoteStatusLabel } from '../lib/constants'
import {
  autoDocGate, fmtMoney, isSold, lockBanner, mergeSaved, readLockState, readScreenTotals, restoreOptionsFor,
  REVISION_ADJ_LABEL, revisionOriginal, revisionReconcile, savedTotalsOf, writeCheck, totalsDiffer } from '../lib/priceLockCrm'
import UseAsRevisionModal from './UseAsRevisionModal'
import DesignLinkModal from './DesignLinkModal'
import { designToQuote, applyDesignToProgram, restoreChecks, mergeChecks } from '../lib/designToQuote'
import { designSeed } from '../lib/designLinks'
import RevisionModal from './RevisionModal'
import { holdBuilderAt, newItemsOf } from '../lib/revisionEngine'
import { r2, revisionMoney } from '../lib/revisionDiff'
import {
  agreementRootOf, agreementSignedDayDb, contractFileBase, executedOf, pdfNameFor, signedContractOf, contractNumberFor, contractNumberFromHtml, executedToast, markExecuted, markQuote, newDetailOf, nextRevNo,
  paidOf, revisedBalance, revisedContractNumber, revisionDocFor, revisionsAfterRedo,
} from '../lib/contractDocs'

const SRC = '/build/build.html'

// White "Save to Lead" button — white background, dark-navy text (matches the
// Generate Contract text color), so it reads clearly against the cyan buttons.
const SAVE_BTN = {
  background: '#ffffff',
  color: '#080f14',
  border: '1px solid #cdd6e0',
  boxShadow: '0 1px 3px rgba(0,0,0,.35)',
  fontWeight: 800,
}

const AUTO_LABEL = { contract: 'Contract', exec: 'Executed copy', revision: 'Revision changes' }
const RUN_LABEL = { contract: 'Generate contract…', exec: 'Generate executed copy…', revision: 'Apply revision changes…' }

// toast() renders HTML — escape anything that comes from the builder.
const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

// Emergency switch: localStorage 'ss_price_lock' = 'off' reopens quotes at
// today's pricing, exactly as before 9/30/26 (the builder honors SS_PRICE_LOCK=false).
function priceLockDisabled() {
  try { return window.localStorage.getItem('ss_price_lock') === 'off' } catch { return false }
}

export default function BuildQuoteModal({ client: clientProp, initialQuote, onSave, onClose, autoContract = false, autoExec = false, revisionChanges = null, fromDesign = null }) {
  // the lead: the prop, or the one picked in Save to Lead (SaveToLeadPicker) — review 10/19/26: a quote saved
  // through the picker then got a made-up contract number and no Save to Doc Hub
  const [clientState, setClientState] = useState(clientProp)
  useEffect(() => { if (clientProp) setClientState(clientProp) }, [clientProp])
  const client = clientState
  // When reopening a saved builder quote, its full state lives in payload_json.
  const restoreData = initialQuote?.payload_json?.fields ? initialQuote.payload_json : null
  const iframeRef = useRef(null)
  const savingRef = useRef(false)
  const [status, setStatus] = useState('')
  // Opened WITHOUT a lead (e.g. Dashboard → New Quote): Save to Lead opens the
  // shared picker to attach to an existing lead or create a new one on the spot.
  const [picker, setPicker] = useState(false)
  const [savedTo, setSavedTo] = useState(null) // lead name after a picker save
  const prefillRef = useRef(false)                 // the lead's contact info is filled in once, never after a save
  const auth = useAuth()
  const userId = auth?.user?.id ?? null
  // a row THIS builder created with "Save as a new quote": its later saves update that row directly (the lead
  // page's handler would update the quote the builder was opened on)
  const ownRowRef = useRef(null)
  // the save: the lead page's (QuotesTab), or — opened without a lead (Dashboard) — the row saved through the
  // picker is updated in place (review 10/19/26: the second Save had nothing to call)
  const save = (payload, cur) => {
    if (cur?.id && ownRowRef.current === cur.id) return updateQuoteRow(supabase, cur, payload)
    if (typeof onSave === 'function') return onSave(payload, cur)
    return cur?.id ? updateQuoteRow(supabase, cur, payload) : Promise.reject(new Error('Pick a lead first (Save to Lead).'))
  }

  // The saved row as it is NOW (updated after each save in this session), so a
  // second save compares against — and records history from — what's saved.
  const quoteRef = useRef(initialQuote || null)
  // ...and the part the bar shows (title, Update Quote ▾); set after every save that changes the quote in hand
  const [curQuote, setCurQuote] = useState(initialQuote?.id ? { id: initialQuote.id, quote_number: initialQuote.quote_number || null } : null)
  // the build as read right after it was opened / last saved — Done asks before dropping changes made since
  const baselineRef = useRef(null)
  const restoredRef = useRef(false)
  const revAppliedRef = useRef(false)
  const [banner, setBanner] = useState(null)       // saved-vs-today bar (lib/priceLockCrm lockBanner)
  const [blocked, setBlocked] = useState(null)     // {kind, reason}: an automatic document that did not run
  const [pendingContract, setPendingContract] = useState(null) // { html, num, quoteId }: a contract generated to LOOK at, not saved yet
  const [ask, setAsk] = useState(null)             // the confirm dialog's writeCheck()
  const askResolveRef = useRef(null)
  const [uar, setUar] = useState(false)            // Use as revision: pick the signed quote + how
  const [needDay, setNeedDay] = useState(null)     // { node, number, retry } — the agreement's signed day, asked before a revised contract
  const [uarManual, setUarManual] = useState(null) // {original, info}: Use as revision → type the changes
  const [designLink, setDesignLink] = useState(false) // the program's SEND DESIGN LINK → DesignLinkModal (owner 10/16/26)
  const [designChecks, setDesignChecks] = useState(null) // Build quote from a customer design: { items, open } (owner 10/21/26)
  const uarOpenRef = useRef(() => {})
  // the program's hooked buttons (SAVE QUOTE / GENERATE CONTRACT / EXECUTED COPY) are wired once; they call
  // through these refs so they always see the latest lead / quote (review 10/19/26: the first render's
  // closures still had no lead after a picker save)
  const saveToLeadRef = useRef(() => {})
  const contractRef = useRef(() => {})
  const execRef = useRef(() => {})

  const revisionRows = revisionChanges ? (revisionChanges.rows || revisionChanges) : null
  const hasRevisionRows = !!(revisionRows && revisionRows.length)

  // The QTEPRO program lives in build.html's LEFT-pane iframe. Reach it (same-origin).
  function getProgramWindow() {
    try {
      const inner = iframeRef.current?.contentWindow?.document?.querySelector('iframe')
      const pg = inner?.contentWindow
      return pg && typeof pg.collectQuoteData === 'function' ? pg : null
    } catch { return null }
  }

  // ── Price lock: bar, confirm, automatic documents ──
  function refreshBanner() {
    if (!restoredRef.current) return
    const pg = getProgramWindow()
    if (!pg) return
    const b = lockBanner({ saved: savedTotalsOf(quoteRef.current), screen: readScreenTotals(pg), lock: readLockState(pg) })
    setBanner((prev) => (JSON.stringify(prev) === JSON.stringify(b) ? prev : b))
  }

  // Resolves true when the write may go ahead. Every write to a quote that
  // already has a saved price shows the dialog (saved → new, or "no price
  // change"); only a brand-new quote (nothing saved yet) goes straight through.
  function confirmWrite(kind, extra = {}) {
    const pg = getProgramWindow()
    const cur = quoteRef.current
    const check = writeCheck({
      kind, saved: savedTotalsOf(cur), next: readScreenTotals(pg), lock: readLockState(pg), status: cur?.status, ...extra,
    })
    if (!check.confirm) return Promise.resolve(true)
    return askConfirm(check)
  }
  // the one confirm dialog (PriceChangeConfirm) with any check object; resolves true / false / 'preview'
  function askConfirm(check) {
    return new Promise((resolve) => {
      if (askResolveRef.current) askResolveRef.current(false) // never two dialogs at once
      askResolveRef.current = resolve
      setAsk(check)
    })
  }

  // ── The quote in hand: after a save, the bar shows it and Done measures changes from it ──
  function takeBaseline() {
    const pg = getProgramWindow()
    try { baselineRef.current = pg ? buildSignature(pg.collectQuoteData()) : null } catch { baselineRef.current = null }
  }
  function markSaved() {
    const q = quoteRef.current
    setCurQuote(q && q.id ? { id: q.id, quote_number: q.quote_number || null } : null)
    takeBaseline()
  }
  // Unsaved changes on a saved quote (null = nothing saved yet: Done closes as it always did)
  function unsavedNow() {
    const cur = quoteRef.current
    if (!cur || !cur.id) return null
    const pg = getProgramWindow()
    if (!pg) return null
    let sig = null
    try { sig = buildSignature(pg.collectQuoteData()) } catch { sig = null }
    return unsavedCheck({ baseline: baselineRef.current, sig, saved: savedTotalsOf(cur), screen: readScreenTotals(pg), lock: readLockState(pg) })
  }

  // ── Save as a new quote (owner 10/24/26: keep BOTH versions) ──
  // The build on screen becomes a NEW quote row for this lead; the quote the builder was editing is never written.
  // A new quote is priced like any new quote: the program first drops the reopened quote's held price and
  // grandfathered rules (lib/saveAsNew prepareProgramForNewQuote → PriceLock.freshen) and the new row is saved at
  // exactly what it shows then (asked first when that moved the price). Numbered, dated, PDF'd and saved like a
  // first Save to Lead (lib/builderSave harvestAndSaveQuote with no quote in hand); the builder then carries on
  // with the new quote.
  async function saveAsNew() {
    if (savingRef.current || status) return
    const pg = getProgramWindow()
    if (!pg) { toast('The builder is still loading — give it a moment and try again.'); return }
    const original = quoteRef.current
    const why = saveAsNewBlocker({ original, revisionChanges })
    if (why) { toast(escHtml(why)); return }
    if (!client?.id) { toast('Pick a lead first (Save to Lead).'); return }
    const origNo = original.quote_number ? `#${original.quote_number}` : 'The original quote'
    savingRef.current = true
    try {
      setStatus('Pricing it as a new quote…')
      const prep = prepareProgramForNewQuote(pg)
      refreshBanner()
      if (!prep.ok) { toast(`Not saved as a new quote — ${escHtml(prep.reason)}. Nothing was saved.`); return }
      if (!prep.after) { toast('No price yet — set a width, length and height first. Nothing was saved.'); return }
      // nothing of the original's held / signed price may be left in the program now
      let left = []
      try {
        let priced = null
        try { priced = pg.PriceLock && typeof pg.PriceLock.snapshot === 'function' ? pg.PriceLock.snapshot() : null } catch { priced = null }
        left = saveAsNewProblems({ ...pg.collectQuoteData(), priced })
      } catch { left = [] }
      if (left.length) { toast(`Not saved as a new quote: ${escHtml(left.join('; '))}. Close and reopen the quote, then try again. Nothing was saved.`); return }
      // switching to today's pricing moved the price the rep was looking at: show it before anything is saved
      if (prep.before && totalsDiffer(prep.before, prep.after)) {
        setStatus('')
        const go = await askConfirm(saveAsNewConfirm({ original, before: prep.before, after: prep.after }))
        if (go !== true) { toast(`Nothing saved — ${escHtml(origNo)} is unchanged. The builder now shows today’s pricing.`); return }
      }
      const res = await harvestAndSaveQuote({
        pg,
        buildWin: iframeRef.current?.contentWindow,
        client,
        initialQuote: null, // a brand-new quote: no saved price, history or marks of the original
        onSave: async (payload) => {
          const row = saveAsNewRow({ payload, original, clientId: client.id, userId, now: new Date() })
          const { data, error } = await supabase.from('quotes').insert(row).select().single()
          if (error) throw error
          promoteToWorking(client.id, userId).catch(() => {}) // a saved quote = the lead has been quoted (forward-only)
          return Array.isArray(data) ? data[0] : data
        },
        setStatus,
      })
      const saved = res.saved
      if (!saved || !saved.id) throw new Error('The new quote may not have been saved — check the lead’s Quotes before trying again.')
      quoteRef.current = saved
      ownRowRef.current = saved.id
      finishProgramForNewQuote(pg) // the original's "as ordered" revision baseline goes with it
      setPendingContract(null)     // a contract generated for the original is not this quote's
      setBlocked(null)             // nor is an automatic document that did not run for it
      markSaved()
      refreshBanner()
      toast(`Saved as new quote #${escHtml(saved.quote_number || '')} — ${escHtml(origNo)} is unchanged${res.pdfWarn ? `. ${escHtml(res.pdfWarn)}` : ''}`, res.pdfWarn ? undefined : 'success')
    } catch (e) {
      toast(escHtml((e && e.message) || 'Could not save the new quote.'))
    } finally {
      savingRef.current = false
      setStatus('')
    }
  }
  function answer(yes) {
    const r = askResolveRef.current
    askResolveRef.current = null
    setAsk(null)
    if (r) r(yes === 'preview' ? 'preview' : !!yes)
  }

  async function saveToLead() {
    if (savingRef.current) return
    const pg = getProgramWindow()
    if (!pg) { toast('The builder is still loading — give it a moment and try again.'); return }
    if (!client?.id) { setPicker(true); return } // no lead yet → pick or create one
    savingRef.current = true
    let go = false
    try { go = await confirmWrite('save') } catch { go = false }
    if (!go) { savingRef.current = false; return }
    setStatus('Reading quote…')
    try {
      // Shared harvest+save flow (lib/builderSave) — also used by the
      // standalone 3D Builder tab's Save to Lead.
      const { quote_number, pdfWarn, payload, saved } = await harvestAndSaveQuote({
        pg,
        buildWin: iframeRef.current?.contentWindow,
        client,
        initialQuote: quoteRef.current,
        onSave: save,
        setStatus,
      })
      if (quoteRef.current) quoteRef.current = mergeSaved(quoteRef.current, payload)
      if (quoteRef.current && saved && saved.payload_json && saved.id === quoteRef.current.id) quoteRef.current = { ...quoteRef.current, payload_json: saved.payload_json } // the live signed mark
      // a NEW quote: its saved row is the quote in hand from now on — Generate Contract carries ITS number and
      // a second Save updates it (10/19/26: contracts printed right after a first save carried made-up numbers)
      else if (saved) quoteRef.current = saved
      setPendingContract(null) // a contract generated before this save no longer matches
      setStatus('')
      savingRef.current = false
      markSaved()
      refreshBanner()
      toast(pdfWarn ? escHtml(pdfWarn) : `Quote ${escHtml(quote_number)} saved to ${escHtml(client.name || 'lead')}`, pdfWarn ? undefined : 'success')
    } catch (e) {
      setStatus(''); savingRef.current = false
      toast(escHtml(e.message || 'Could not save the quote.'))
    }
  }

  // Automatic Generate Contract / Executed Copy / revision apply (opened from a
  // quote card). Runs only while the saved price is held to the cent with no
  // open issues; otherwise it stops, says why, and offers a manual button.
  function runAuto(kind, tries) {
    const pg = getProgramWindow()
    const g = autoDocGate({ saved: savedTotalsOf(quoteRef.current), screen: readScreenTotals(pg), lock: readLockState(pg) })
    if (!g.ok && g.wait && tries < 12) { setTimeout(() => runAuto(kind, tries + 1), 500); return }
    refreshBanner()
    if (!g.ok) {
      setStatus('')
      setBlocked({ kind, reason: g.reason })
      toast(`${AUTO_LABEL[kind]} not run automatically — ${escHtml(g.reason)}`)
      return
    }
    // Contract / executed copy are writes (a PDF lands in Documents), so they go
    // through the same confirm dialog (saved → new) before anything is saved.
    if (kind === 'exec') saveExecutedThenPrint(pg)
    else if (kind === 'contract') saveContractThenPrint(pg)
    else { revAppliedRef.current = true; applyRevisionChanges(pg, revisionRows) }
  }

  // The rep runs a blocked automatic document by hand (after seeing saved → new).
  async function runBlocked() {
    const b = blocked
    const pg = getProgramWindow()
    if (!b || !pg) return
    const go = await confirmWrite(b.kind === 'revision' ? 'apply' : b.kind, { force: true, reason: b.reason })
    if (!go) return
    setBlocked(null)
    if (b.kind === 'exec') await saveExecutedThenPrint(pg, { confirmed: true })
    else if (b.kind === 'contract') await saveContractThenPrint(pg, { confirmed: true })
    else { revAppliedRef.current = true; applyRevisionChanges(pg, revisionRows) }
  }

  // Reopen a saved quote: once the program is ready, restore its full state
  // (fields, doors, windows, lean-tos, manufacturer) via the program's own
  // restoreQuoteData — at the SAVED price (price lock) unless there is none to
  // hold (a fresh duplicate, or a quote with no total). From here the user can
  // adjust and re-save, or hit the program's Generate Contract.
  useEffect(() => {
    if (!restoreData) return
    let done = false
    const t = setInterval(() => {
      if (done) return
      const pg = getProgramWindow()
      if (!pg || typeof pg.restoreQuoteData !== 'function') return
      // Wait for the program page to finish loading: the price lock
      // (window.PriceLock) is the LAST script in quote-builder.html, and a
      // restore that runs before it exists silently reprices at today's rules.
      try { if (pg.document.readyState !== 'complete') return } catch { return }
      done = true
      clearInterval(t)
      const opts = restoreOptionsFor(initialQuote)
      try { if (priceLockDisabled()) pg.SS_PRICE_LOCK = false } catch { /* ignore */ }
      let ok = true
      try {
        if (opts) pg.restoreQuoteData(restoreData, opts)
        else pg.restoreQuoteData(restoreData)
      } catch (e) { ok = false; console.warn('restore failed', e) }
      restoredRef.current = true
      refreshBanner()
      const lock = readLockState(pg)
      const saved = savedTotalsOf(initialQuote)
      const num = initialQuote?.quote_number || ''
      const pending = autoExec ? 'exec' : autoContract ? 'contract' : hasRevisionRows ? 'revision' : null
      // Done's "unsaved changes" baseline: the build as reopened, read once the program has settled (before the
      // revision rows are applied, so those count as changes)
      if (ok) { if (pending === 'revision') takeBaseline(); else setTimeout(takeBaseline, 1200) }
      const next = pending === 'exec' ? ' — generating executed copy…' : pending === 'contract' ? ' — generating contract…' : pending === 'revision' ? '' : ' — adjust and re-save'
      let msg
      if (!ok) msg = "Couldn't fully load this quote's saved build — please rebuild or check the console."
      else if (opts && lock && lock.requested && lock.active && lock.ok && saved) msg = `Loaded quote ${num} at its saved price${next}`
      else if (opts && lock && lock.requested) msg = `Loaded quote ${num} — the saved price could not be held exactly (see the bar at the top)`
      else if ((!opts || opts.fresh) && initialQuote?.payload_json?.priceFresh) msg = `Loaded copy ${num} — priced at today's rules${next}`
      else msg = `Loaded quote ${num}${next}`
      toast(msg.replace(/\s+/g, ' ').trim(), ok ? 'success' : undefined)
      // "Generate Contract" / "Executed Copy" from a quote card: once the build is
      // fully restored and the saved price is held, auto-run the same
      // save-to-Doc-Hub + print flow the rep would trigger by hand. Revision
      // flow: apply the modal's structured changes AFTER the program stashes
      // its as-ordered snapshot (~900ms post-restore) so the applied components
      // count as NEW (highlighted on the revised contract).
      if (ok && pending) {
        setStatus(pending === 'exec' ? 'Generating executed copy…' : pending === 'contract' ? 'Generating contract…' : 'Applying revision changes…')
        setTimeout(() => runAuto(pending, 0), pending === 'revision' ? 1800 : 1400)
      }
    }, 500)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Keep the saved-vs-today bar current (cheap: three cells + the lock state).
  useEffect(() => {
    if (!restoreData) return
    const t = setInterval(refreshBanner, 1000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Prefill the program's Client Information from the lead, once — name, phone,
  // email and ZIP. We set each input and fire the program's OWN handlers (sy /
  // doZip) so it behaves exactly as if typed: the quote/PDF picks up the contact
  // info and the ZIP resolves city/county/state. We never overwrite a field the
  // user already filled, and never touch the program's source.
  useEffect(() => {
    if (!client || restoreData || fromDesign || prefillRef.current || quoteRef.current?.id) return // editing a saved quote (or one just saved) carries its own client info; a customer design fills it below
    let done = false
    const t = setInterval(() => {
      if (done) return
      const pg = getProgramWindow()
      const d = pg?.document
      if (!pg || !d || !d.getElementById('cn')) return // program not ready yet
      const set = (id, val) => { const el = d.getElementById(id); if (el && !el.value && val) el.value = String(val) }
      set('cn', client.name)
      set('cp', client.phone)
      set('ce', client.email)
      try { if (typeof pg.sy === 'function') pg.sy() } catch { /* ignore */ }
      const zipEl = d.getElementById('zip')
      const zip = client.zip ? String(client.zip).replace(/\D/g, '').slice(0, 5) : ''
      if (zipEl && !zipEl.value && zip) {
        zipEl.value = zip
        try { if (typeof pg.doZip === 'function') pg.doZip(zip) } catch { /* ignore */ }
      }
      done = true
      prefillRef.current = true
      clearInterval(t)
      toast('Client info filled in from the lead', 'success')
    }, 500)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client])

  // Build quote from a customer design (owner 10/21/26): once the program page is fully loaded (the price lock is its
  // LAST script), fill it in with the design at TODAY's pricing (lib/designToQuote: the program's own restoreQuoteData +
  // the ZIP's county rules), then the lead's contact info, then read the program back and list for the rep everything
  // it could not take exactly as the customer drew it. No quote row is written here.
  useEffect(() => {
    if (!fromDesign || restoreData) return undefined
    let done = false
    let alive = true
    const t = setInterval(async () => {
      if (done) return
      const pg = getProgramWindow()
      if (!pg || typeof pg.restoreQuoteData !== 'function') return
      try { if (pg.document.readyState !== 'complete' || !pg.PriceLock) return } catch { return }
      done = true
      clearInterval(t)
      // a link started from a quote: what the page could not show from that quote (design_links.seed_notes)
      let seed = { notes: [], quoteNumber: null }
      try { if (fromDesign.link_token && fromDesign.design_links?.kind !== 'shared') seed = await designSeed(supabase, fromDesign.link_token) } catch { /* no notes */ }
      if (!alive) return
      const res = designToQuote(fromDesign.design, { zip: fromDesign.zip, leadZip: client?.zip, seedNotes: seed.notes, seedQuoteNumber: seed.quoteNumber })
      if (!res.ok) { toast(`This design can't fill in the quote program: ${escHtml(res.reason)}`); return }
      let ok = true
      try { applyDesignToProgram(pg, res.payload) } catch (e) { ok = false; console.warn('design fill failed', e) }
      // Client Information: the lead's, else what the customer typed when sending (never over a value already there)
      try {
        const d = pg.document
        const set = (id, val) => { const el = d.getElementById(id); if (el && !el.value && val) el.value = String(val) }
        set('cn', client?.name || fromDesign.name)
        set('cp', client?.phone || fromDesign.phone)
        set('ce', client?.email || fromDesign.email)
        if (typeof pg.sy === 'function') pg.sy()
      } catch { /* typed by the rep */ }
      prefillRef.current = true
      // the restore finishes a few follow-ups on timers (no-overlap model, labels) before it is read back
      await new Promise((r) => setTimeout(r, 900))
      if (!alive) return
      let back = null
      try { back = pg.collectQuoteData() } catch { back = null }
      let county = null
      try { county = (pg.document.getElementById('county') || {}).textContent || null } catch { /* ignore */ }
      const fromProgram = ok ? restoreChecks(res.payload, back, { T: pg._qTotals || null, county: county && county !== '—' ? county : null })
        : [{ level: 'warn', text: 'The quote program could not take the whole design: compare every part of the build with the design (Show the spec) before quoting.' }]
      const items = mergeChecks(res.checks, fromProgram)
      setDesignChecks({ items, open: true })
      const nWarn = items.filter((c) => c.level === 'warn').length
      toast(`Filled in from ${escHtml(fromDesign.name || 'the customer')}'s design${nWarn ? ` — ${nWarn} thing${nWarn === 1 ? '' : 's'} to check before quoting` : ''}`, nWarn ? undefined : 'success')
    }, 500)
    return () => { alive = false; clearInterval(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Once the nested program is ready, relabel its SAVE QUOTE button(s) → "Save to
  // Lead" and route their click to the CRM save. Polls (the program loads async).
  useEffect(() => {
    // Route the program's SAVE QUOTE (and "Save Current Quote") click to the CRM
    // save when used from a lead. The button's WHITE styling comes from the
    // program itself now, so we don't touch its appearance — just its action.
    const tick = () => {
      const pg = getProgramWindow()
      if (!pg) return
      const btns = [...pg.document.querySelectorAll('button')].filter((b) =>
        /saveQuote/.test(b.getAttribute('onclick') || '') || /save current quote/i.test(b.textContent || ''),
      )
      btns.forEach((b) => {
        if (b.dataset.ssHooked === '1') return
        b.dataset.ssHooked = '1'
        b.removeAttribute('onclick')
        b.onclick = null
        b.addEventListener('click', (e) => { e.preventDefault(); e.stopImmediatePropagation(); saveToLeadRef.current() }, true)
      })
    }
    const t = setInterval(tick, 600)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Apply the Revision modal's structured rows to the live build: add roll-ups
  // (with size, wall, hoist/seal/opener), walk doors, windows; remove matching
  // components; change building size. Anything it can't apply is reported so
  // the rep does that one by hand. Placement stays with the rep — drag it.
  function applyRevisionChanges(pg, changes) {
    setPendingContract(null)
    if (!pg) return
    const d = pg.document
    const set = (el, v) => { if (!el) return false; el.value = v; el.dispatchEvent(new pg.Event('change', { bubbles: true })); return true }
    const skipped = []
    try {
      for (const r of changes) {
        if (r.type === 'size') {
          const to = String(r.to || '').replace(/×/g, 'x').match(/(\d+)\s*x\s*(\d+)\s*x\s*(\d+)/i)
          if (to) {
            set(d.getElementById('bw'), to[1]); set(d.getElementById('bl'), to[2]); set(d.getElementById('bh'), to[3])
            try { pg.doBld() } catch { /* rc below */ }
          } else skipped.push('Size change — set Width/Length/Height by hand')
        } else if (r.type === 'add') {
          // Duplicate guard: if the SAVED quote already carries a matching
          // component on that wall (e.g. from an earlier test-run that got
          // saved), warn the rep instead of silently stacking a second one.
          const dupSel = r.comp === 'Roll-Up Door' ? '.re' : r.comp === 'Walk-Through Door' ? '.we' : r.comp === 'Window' ? '.ne' : null
          if (dupSel) {
            const dup = [...d.querySelectorAll(dupSel)].some((el) => {
              const sz = (el.querySelector('.rsz') || {}).value || ''
              const loc = (el.querySelector('.rloc') || el.querySelector('.wloc') || el.querySelector('.nloc') || {}).value || ''
              return (!r.size || sz === r.size) && (!r.wall || r.wall === '—' || loc === r.wall)
            })
            if (dup) skipped.push(`⚠ ${r.wall || 'the build'} already had a ${r.comp}${r.size ? ' ' + r.size : ''} — added anyway, remove one if it's a leftover`)
          }
          if (r.comp === 'Roll-Up Door' && typeof pg.aRUD === 'function') {
            pg.aRUD()
            const el = [...d.querySelectorAll('.re')].pop()
            if (r.size) set(el.querySelector('.rsz'), r.size)
            if (r.wall && r.wall !== '—') set(el.querySelector('.rloc'), r.wall)
            if (r.hoist && !r.hoistIncluded) set(el.querySelector('.rch'), '1')
            if (r.seal) set(el.querySelector('.rsl'), '1')
            if (r.opener) set(el.querySelector('.rop'), '1')
          } else if (r.comp === 'Walk-Through Door' && typeof pg.aWTD === 'function') {
            pg.aWTD()
            const el = [...d.querySelectorAll('.we')].pop()
            if (r.wall && r.wall !== '—') set(el.querySelector('.wloc'), r.wall)
          } else if (r.comp === 'Window' && typeof pg.aWIN === 'function') {
            pg.aWIN()
            const el = [...d.querySelectorAll('.ne')].pop()
            if (r.wall && r.wall !== '—') set(el.querySelector('.nloc'), r.wall)
          } else {
            skipped.push(`Add ${r.comp} — add it by hand`)
          }
        } else if (r.type === 'remove') {
          const sel = r.comp === 'Roll-Up Door' ? '.re' : r.comp === 'Walk-Through Door' ? '.we' : r.comp === 'Window' ? '.ne' : null
          let hit = null
          if (sel) {
            hit = [...d.querySelectorAll(sel)].find((el) => {
              const sz = (el.querySelector('.rsz') || {}).value || ''
              const loc = (el.querySelector('.rloc') || el.querySelector('.wloc') || el.querySelector('.nloc') || {}).value || ''
              return (!r.size || sz === r.size) && (!r.wall || r.wall === '—' || loc === r.wall)
            })
          }
          const rm = hit && hit.querySelector('button.rm')
          if (rm) rm.click()
          else skipped.push(`Remove ${r.comp}${r.size ? ' ' + r.size : ''} — remove it by hand`)
        }
      }
      try { pg.rc() } catch { /* ignore */ }
    } catch (e) { console.warn('apply revision changes failed', e) }
    setStatus('')
    refreshBanner()
    toast(skipped.length
      ? `Changes applied — do these by hand: ${escHtml(skipped.join('; '))}`
      : 'Changes applied — place the components, then hit FINISH REVISION (top right)', 'success')
  }

  // Finish Revision: the rep has placed everything — NOW generate both papers
  // from the final build: the Revision Order (engine-diffed totals) saved to
  // Documents › Revisions, then the Revised Contract (highlighted changes,
  // renderings, floor plan + spacing sheet) via the normal contract path.
  // The revised build, totals and price history are saved on the quote row so
  // the next reopen shows the revised order (not the pre-revision one).
  async function finishRevision() {
    const pg = getProgramWindow()
    if (!pg || !revisionChanges) return
    // An order marked signed is revised with Make a revision (its own quote row) — revising the SAME row
    // would overwrite the signed build and its signed date (review 10/19/26). Nothing was saved yet.
    if (executedOf(quoteRef.current || initialQuote)) {
      toast('This order is marked signed. Make the revision from Documents › Contracts › Actions › “Make a revision of this signed version” — it keeps the signed original as it is. Nothing was saved.')
      return
    }
    if (!revAppliedRef.current && blocked?.kind === 'revision') {
      toast('Apply the revision changes first (button in the bar at the top).')
      return
    }
    // Sold order under the price lock: a new contract waits until every rule
    // that would change the as-sold build has a decision in the builder.
    try {
      if (pg.PriceLock && typeof pg.PriceLock.contractBlocked === 'function' && pg.PriceLock.contractBlocked()) {
        try { pg.PriceLock.showGate() } catch { /* ignore */ }
        toast('Sold order: decide on the rule changes in the builder’s notice (above the Price Breakdown) before the revised contract.')
        return
      }
    } catch { /* older builder: no gate */ }
    if (!(await confirmWrite('revision'))) return
    setPendingContract(null) // the revised contract is the revision's own save
    const rv = revisionChanges
    const cur = quoteRef.current || initialQuote || {}
    // The Revised Contract: "<agreement> Rev <n>" + what changed (the typed rows), handed to the program.
    const ctNo = revisedContractNumber(cur, rv.revNo || '1')
    let rvDoc = null
    try {
      setStatus('Saving revision order…')
      const num = makeRevisionOrderNumber(cur)
      const gv = (id) => { try { return parseFloat(String(pg.G(id).textContent).replace(/[^0-9.-]/g, '')) || 0 } catch { return 0 } }
      const curTot = gv('ptot')
      const curDep = gv('pdep')
      // Same original figures as the Revised Contract (the builder's revision
      // baseline: on an honored sold order, the signed contract's price).
      const base = revisionOriginal({ pg, typed: rv.original, card: { total: cur.total_amount, deposit: cur.deposit_amount } })
      const orig = base.total
      // money already paid on this order (a revised order: across the chain) — credited (lib/contractDocs)
      const origDep = paidOf(cur, base.deposit)
      if (base.from === 'builder' && rv.original && Math.abs(Number(rv.original) - orig) >= 0.005) {
        toast(`Revision Order: Original Contract ${fmtMoney(orig)} — the signed contract price the revised contract uses (the form had ${fmtMoney(Number(rv.original))}).`)
      }
      const net = curTot - orig
      const rows = (rv.rows || []).map((r) => ({ desc: r.printDesc || r.desc, kind: r.printKind || 'Modify', amount: r.amount }))
      // Rep-typed amounts are often LIST prices; the order's totals come from the
      // priced build (discount, tax, today's price of the change). One extra row
      // makes the change rows add up to the order's net change.
      const adj = curTot ? revisionReconcile(rows, net) : 0
      if (adj) rows.push({ desc: REVISION_ADJ_LABEL, kind: 'Modify', amount: adj })
      let agrDay = null // only the agreement's CONFIRMED signed day is printed (null = no date)
      try { agrDay = (await agreementSignedDayDb(supabase, cur)).day } catch { /* no date */ }
      rvDoc = revisionDocFor({ original: cur, lines: rv.rows || [], revNo: rv.revNo || '1', originalTotal: orig, depositPaid: origDep, adjustment: adj, adjLabel: REVISION_ADJ_LABEL, agreementNo: agreementRootOf(cur), agreementSignedDate: agrDay })
      const html = buildRevisionHtml({
        client,
        quote: cur,
        revision: {
          number: num,
          revNo: rv.revNo || '1',
          date: rv.date,
          rows,
          contractNo: ctNo,
          originalLabel: isSold(cur.status) ? null : 'Original Quote Price (not signed yet)',
          original: orig,
          additions: Math.max(net, 0),
          credits: Math.max(-net, 0),
          revised: curTot || orig,
          origDeposit: origDep || null,
          newDeposit: curDep || null,
          newBalance: curTot && curDep ? revisedBalance(curTot, curDep, origDep).balance : null,
          refund: curTot && curDep ? revisedBalance(curTot, curDep, origDep).refund : 0,
          note: rv.note || '',
        },
      })
      const blob = await renderQuotePdf(html)
      try {
        await uploadClientDocBlob(client.id, 'revisions', blob, `${num}.pdf`, 'application/pdf')
        window.dispatchEvent(new CustomEvent('ss:docs-updated', { detail: { clientId: client.id } }))
        toast(`Revision order ${num} saved — generating the revised contract…`, 'success')
      } catch (e) { console.warn('revision upload failed', e) }
    } catch (e) {
      console.warn('finish revision failed', e)
      toast('Could not build the revision order: ' + escHtml(e.message || e))
    }
    // Save the revised build on the quote row (config, totals, price history;
    // status / notes / validity / quote PDF untouched).
    if (initialQuote?.id) {
      try {
        setStatus('Updating the quote…')
        const upd = await harvestRevisionUpdate({ pg, buildWin: iframeRef.current?.contentWindow, initialQuote: cur, setStatus })
        const savedRow = await save(upd, cur)
        quoteRef.current = mergeSaved(cur, upd)
        if (savedRow && savedRow.payload_json && savedRow.id === cur.id) quoteRef.current = { ...quoteRef.current, payload_json: savedRow.payload_json }
      } catch (e) {
        console.warn('revision persist failed', e)
        toast('The revision documents are being saved, but the quote card could not be updated: ' + escHtml(e.message || e))
      }
      // Mark the quote itself as a revised order so the card wears the amber
      // REVISED badge. Needs 'revised' in the quote_status enum (migration 018);
      // without it the status simply stays as it was.
      try {
        const { error } = await supabase.from('quotes').update({ status: 'revised' }).eq('id', initialQuote.id)
        if (error) {
          console.warn('revised status not saved', error)
          toast('Revision saved. The REVISED badge needs the one-time database update (migration 018) — the quote keeps its current status.')
        } else if (quoteRef.current) quoteRef.current = { ...quoteRef.current, status: 'revised' }
      } catch (e) { console.warn('revised status not saved', e) }
    }
    // Force revision mode on the contract even when nothing priced changed
    // (a placement-only revision must still print as REVISED).
    try { const pw = getProgramWindow(); if (pw) pw._rvForce = true } catch { /* ignore */ }
    try {
      await saveContractThenPrint(getProgramWindow(), { confirmed: true, number: ctNo, rvDoc })
    } finally {
      try { const pw = getProgramWindow(); if (pw) pw._rvForce = false } catch { /* ignore */ }
    }
    setStatus('')
    refreshBanner()
  }

  // Save a PDF copy of the contract to the Document Hub (Contracts), then let the
  // program generate it for the rep as usual.
  // Contract number (owner 10/6/26): a first contract carries the quote's own
  // number; a revised one "<original agreement> Rev <n>" (number = passed in);
  // a reprint the number it was first sent with (lib/contractDocs). The program
  // prints window._ctNo / window._rvDoc (read once at the start of each print).
  // A generated contract tags the quote "contract sent" (payload_json.contractSent
  // — a marker, never a status change).
  // Just preview (owner 10/19/26: "i might just be doing it to see how it looks not to send"): the
  // contract opens to look at / print; nothing is saved to Documents and the quote is not tagged.
  // Generate Contract is LOOK-FIRST (owner 10/19/26: "i sometimes click generate contract & then notice an issue
  // but it saves the contract regardless ... there should be a button ... that asks save to doc hub"): the
  // contract opens to look at; the bar then offers Save to Doc Hub. A revised contract (rvDoc) is the
  // revision's own save and goes straight to Documents, as before.
  async function saveContractToHub({ html, num, quoteId }) {
    const blob = await renderQuotePdf(html)
    await uploadClientDocBlob(client.id, 'contract', blob, `${contractFileBase(num)}-contract.pdf`, 'application/pdf')
    try { window.dispatchEvent(new CustomEvent('ss:docs-updated', { detail: { clientId: client.id } })) } catch { /* ignore */ }
    toast(`Contract ${escHtml(num)} saved to ${escHtml(client.name || 'lead')} · Documents › Contracts`, 'success')
    if (quoteId) {
      try {
        const merged = await markQuote(supabase, quoteId, { contractSent: { at: new Date().toISOString(), number: num } })
        if (merged && quoteRef.current && quoteRef.current.id === quoteId) quoteRef.current = { ...quoteRef.current, payload_json: merged }
      } catch (e) { console.warn('contract-sent tag not saved', e) }
    }
  }
  // true only when the contract really reached the Doc Hub
  async function savePendingContract() {
    const p = pendingContract
    if (!p) return false
    if (status) { toast('Wait for the current save to finish, then try again.'); return false }
    // the build or the saved card MOVED since it was generated: never file a contract at the wrong price
    // (a contract generated at a different price than the card was allowed by the dialog — that is not movement)
    const pg = getProgramWindow()
    const screen = pg ? readScreenTotals(pg) : null
    const saved = savedTotalsOf(quoteRef.current)
    if ((p.totals && screen && totalsDiffer(p.totals, screen)) || (p.savedAt && saved && totalsDiffer(p.savedAt, saved))) {
      setPendingContract(null)
      toast('The quote changed since this contract was generated — generate it again (then Save to Doc Hub). Nothing was saved.')
      return false
    }
    setStatus('Saving contract…')
    try { await saveContractToHub(p); setPendingContract(null); return true }
    catch (e) { toast('The contract could not be saved to the Doc Hub: ' + escHtml(e.message || e)); return false }
    finally { setStatus('') }
  }
  // Done with a generated contract still unsaved: ask (OK = save it, Cancel = leave it out)
  // Done on a saved quote with changes not saved yet (owner 10/24/26): ask first (OK = close and lose them)
  async function closeBuilder() {
    const u = savingRef.current ? null : unsavedNow() // (mid-save: closes as it always did)
    if (u && u.dirty && !window.confirm(unsavedMessage({ quoteNumber: quoteRef.current?.quote_number || null, check: u }))) return
    if (pendingContract && window.confirm(`Contract ${pendingContract.num} was generated but not saved to the Doc Hub. OK = save it there first, Cancel = close without saving it.`)) {
      if (await savePendingContract()) onClose() // otherwise the builder stays open with the bar (the toast says why)
      return
    }
    onClose()
  }
  async function saveContractThenPrint(pg, { confirmed = false, number = null, rvDoc = null } = {}) {
    if (!pg) return
    if (!confirmed && client?.id && !(await confirmWrite('contract'))) { setStatus(''); return }
    const autoSave = !!rvDoc
    const cur = quoteRef.current || initialQuote || null
    const ctNo = number || contractNumberFor(cur)
    try { pg._ctNo = ctNo || null; pg._rvDoc = rvDoc || null } catch { /* ignore */ }
    try {
      try {
        if (client?.id) {
          setStatus(autoSave ? 'Saving contract…' : 'Preparing the contract…')
          const html = await captureContractHtml(pg)
          if (html && html.length > 3000) {
            const num = ctNo || contractNumberFromHtml(html) || quoteNumberFromHtml(html) || `SS-${new Date().getFullYear()}`
            if (autoSave) await saveContractToHub({ html, num, quoteId: cur?.id || null })
            else if (cur?.id) setPendingContract({ html, num, quoteId: cur.id, totals: readScreenTotals(pg), savedAt: savedTotalsOf(cur) })
            else toast('Preview only — Save to Lead first; Save to Doc Hub then keeps the contract on the lead.')
          }
        }
      } catch (e) {
        console.warn('contract save failed', e)
      } finally {
        setStatus('')
      }
      try { pg.printContract() } catch (e) { toast('Could not open the contract: ' + escHtml(e.message || e)) }
    } finally {
      // printContract reads both before its first await, so they can go now
      try { pg._ctNo = null; pg._rvDoc = null } catch { /* ignore */ }
    }
  }

  // Executed Copy — Deposit Paid: same flow as saveContractThenPrint, but with the
  // builder's EXEC_COPY flag raised so both the Doc-Hub PDF and the printed copy
  // carry the logo + DEPOSIT PAID watermark and the "Deposit PAID" payment line.
  async function saveExecutedThenPrint(pg, { confirmed = false } = {}) {
    if (!pg) return
    if (!confirmed && client?.id && !(await confirmWrite('exec'))) { setStatus(''); return }
    // the executed copy carries the contract's own number (lib/contractDocs)
    const ctNo = contractNumberFor(quoteRef.current || initialQuote || null)
    try { pg._ctNo = ctNo || null } catch { /* ignore */ }
    try {
      try {
        if (client?.id) {
          setStatus('Saving executed copy…')
          pg.EXEC_COPY = true
          let html
          try { html = await captureContractHtml(pg) } finally { pg.EXEC_COPY = false }
          if (html && html.length > 3000) {
            const blob = await renderQuotePdf(html)
            const num = ctNo || contractNumberFromHtml(html) || quoteNumberFromHtml(html) || `SS-${new Date().getFullYear()}`
            const stampedPath = await uploadClientDocBlob(client.id, 'contract', blob, `${contractFileBase(num)}-executed-deposit-paid.pdf`, 'application/pdf')
            try { window.dispatchEvent(new CustomEvent('ss:docs-updated', { detail: { clientId: client.id } })) } catch { /* ignore */ }
            toast(`Executed copy saved to ${escHtml(client.name || 'lead')} · Documents › Contracts`, 'success')
            // same effect as the Doc Hub stamp: Deposit Paid (never a step back), executed date, star
            const curQ = quoteRef.current || initialQuote || null
            if (curQ?.id) {
              try {
                // the signed day already set is KEPT (never moved to today); none yet = today, not confirmed
                const res = await markExecuted(supabase, curQ.id, { stampedPath, number: num, keepStamped: true })
                if (quoteRef.current && quoteRef.current.id === curQ.id) quoteRef.current = { ...quoteRef.current, status: res.status, payload_json: { ...(quoteRef.current.payload_json || {}), executed: res.payload_json.executed }, ...(res.starred ? { starred: true } : {}) }
                toast(executedToast(res, quoteStatusLabel(curQ.status)), 'success')
              } catch (e) { toast(`Quote #${escHtml(curQ.quote_number || '')} could not be marked Deposit Paid: ${escHtml(e.message || e)}`) }
            }
          }
        }
      } catch (e) {
        console.warn('executed copy save failed', e)
      } finally {
        setStatus('')
      }
      try { pg.printExecutedCopy() } catch (e) { toast('Could not open the executed copy: ' + escHtml(e.message || e)) }
    } finally {
      try { pg._ctNo = null } catch { /* ignore */ }
    }
  }

  // ── Use as revision (owner 10/6/26) ──
  // The program's USE AS REVISION button (it replaced REVISION FORM): THIS quote —
  // usually a duplicate of a signed quote with the changes already made — becomes
  // the revised contract for the signed quote. Pricing rule (same as the Revision
  // Order flow): everything that did not change keeps the SIGNED price; only the
  // changes are priced (today's prices, by the program — lib/revisionEngine).
  function openUseAsRevision() {
    const pg = getProgramWindow()
    if (!pg) { toast('The builder is still loading — give it a moment and try again.'); return }
    if (status || savingRef.current) return
    if (!client?.id) { toast('Use as Revision works on a lead’s quote — open this quote from the lead’s Quotes.'); return }
    if (!(quoteRef.current || initialQuote)?.id) { toast('Save this quote to the lead first (Save to Lead), then Use as Revision.'); return }
    setUar(true)
  }
  uarOpenRef.current = openUseAsRevision
  saveToLeadRef.current = saveToLead
  contractRef.current = saveContractThenPrint
  execRef.current = saveExecutedThenPrint

  // Route the program's button to the CRM (capture phase, like Save to Lead /
  // Generate Contract), and offer window.__ssUseAsRevision, which the program's
  // own useAsRevision() looks for. Without the CRM the program opens its
  // Revision Form instead (standalone 3D Builder).
  useEffect(() => {
    const hook = () => uarOpenRef.current()
    window.__ssUseAsRevision = hook
    const tick = () => {
      const pg = getProgramWindow()
      if (!pg || !pg.document) return
      const btns = [...pg.document.querySelectorAll('button')].filter((b) => /useAsRevision|printRevisionForm/.test(b.getAttribute('onclick') || ''))
      btns.forEach((b) => {
        if (b.dataset.ssUarHooked === '1') return
        b.dataset.ssUarHooked = '1'
        if (/revision form/i.test(b.textContent || '')) b.textContent = 'USE AS REVISION' // an older program copy
        b.removeAttribute('onclick')
        b.onclick = null
        b.addEventListener('click', (e) => { e.preventDefault(); e.stopImmediatePropagation(); uarOpenRef.current() }, true)
      })
    }
    const t = setInterval(tick, 600)
    return () => { clearInterval(t); if (window.__ssUseAsRevision === hook) delete window.__ssUseAsRevision }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // SEND DESIGN LINK (owner 10/16/26): the program's button (it replaced TEXT QUOTE
  // TO CLIENT) calls window.__ssSendDesignLink; the CRM makes this lead's personal
  // no-price design link. Opened without a lead, the dialog asks which lead first.
  useEffect(() => {
    const hook = () => setDesignLink(true)
    window.__ssSendDesignLink = hook
    return () => { if (window.__ssSendDesignLink === hook) delete window.__ssSendDesignLink }
  }, [])

  // Manual: the rep typed the change lines (RevisionModal). Amounts typed as
  // list prices are subtotal dollars; "final" amounts are taken back through the
  // order's discount / tax so the revised total lands on them (the adjustment
  // line carries any cents of rounding).
  function finishUseAsRevisionManual(rv) {
    const m = uarManual
    if (!m) return
    const fac = Number(rv.listFactor) || 1
    const lines = (rv.rows || []).map((row, i) => {
      const typed = Number(row.amount) || 0
      return { id: 'm' + i, kind: 'manual', desc: row.printDesc, printKind: row.printKind, amount: rv.amtMode === 'list' ? r2(typed) : r2(typed / fac), printAmount: r2(typed) }
    })
    if (rv.original && Math.abs(Number(rv.original) - m.info.signed.total) >= 0.005) {
      toast(`Original contract: ${fmtMoney(m.info.signed.total)} — the signed contract’s price (the form had ${fmtMoney(Number(rv.original))}).`)
    }
    finishUseAsRevision({
      original: m.original, mode: 'manual', lines, signed: m.info.signed, terms: m.info.terms, forward: m.info.forward,
      origDims: m.info.origDims, newItems: m.info.newItems, newDetail: m.info.newDetail, aewChanged: m.info.aewChanged, baseToday: m.info.baseToday, origWraps: m.info.origWraps, revNo: rv.revNo, date: rv.date, note: rv.note,
      redo: m.redo ? { ids: m.redo.redo.map((q) => q.id), dropped: m.redo.dropped || [] } : null,
      repSigned: !!m.repSigned,
    })
  }

  // Create the revised contract: hold the builder at signed price + changes,
  // save the Revision Order (Documents › Revisions), save this quote as the
  // active order (linked to the signed one), mark the signed quote revised, then
  // generate the Revised Contract from the held build. Nothing is written unless
  // the builder holds the revised totals to the cent.
  async function finishUseAsRevision(r, { agreementDay } = {}) {
    const pg = getProgramWindow()
    if (!pg || savingRef.current) return
    savingRef.current = true // before any await: a double click never starts two runs
    setPendingContract(null) // the revised contract is the revision's own save
    const { original } = r
    // A revised contract of a SIGNED order prints "…to Agreement X, signed <day>": that day must be the one
    // the customer really signed (never a stamp-click day — Peter Mawn's "October 13"). Not known yet →
    // ask now (nothing saved), then go on by itself with the day typed (owner 10/19/26).
    let agrDay = agreementDay !== undefined ? agreementDay : null
    if (agreementDay === undefined && (isSold(original.status) || r.repSigned === true)) {
      let a = null
      try { a = await agreementSignedDayDb(supabase, original, { repSigned: r.repSigned === true }) } catch { a = null }
      if (a && a.needsDay) {
        savingRef.current = false
        setNeedDay({ node: a.node, number: a.number, retry: (day) => finishUseAsRevision(r, { agreementDay: day }) })
        return
      }
      agrDay = a ? a.day : null
    }
    const cur = quoteRef.current || initialQuote || {}
    const orderStatus = isSold(original.status) ? original.status : (cur.status || 'draft')
    setUar(false); setUarManual(null)
    let money
    try {
      setStatus('Holding the revised price…')
      money = r.money || revisionMoney({ signed: r.signed, lines: r.lines, forward: r.forward })
      // what the buyer has actually paid (the original's deposit; on a revised order everything
      // paid across the chain) — credited on every document by ONE rule (contractDocs.revisedBalance)
      const paid = paidOf(original, r.signed.deposit)
      const bal = revisedBalance(money.total, money.deposit, paid)
      const held = holdBuilderAt({
        pg, targetSub: money.targetSub, money: money.money, terms: r.terms, status: orderStatus, signed: { ...r.signed, deposit: paid },
        origDims: r.origDims, newItems: r.newItems || newItemsOf(r.lines), newDetail: r.newDetail || newDetailOf(r.lines), aewChanged: !!r.aewChanged, baseToday: r.baseToday, origWraps: r.origWraps || null,
      })
      refreshBanner()
      if (!held.ok) { toast(`Revised contract not created — ${escHtml(held.reason)} Nothing was saved.`); return }
      try {
        if (pg.PriceLock && typeof pg.PriceLock.contractBlocked === 'function' && pg.PriceLock.contractBlocked()) {
          try { pg.PriceLock.showGate() } catch { /* ignore */ }
          toast('Sold order: decide on the rule changes in the builder’s notice (above the Price Breakdown), then Use as Revision again. Nothing was saved.')
          return
        }
      } catch { /* older builder: no gate */ }

      // 1) Revision Order — original contract, every change line, the adjustment
      //    line (discount / tax) so the rows add up to the net change exactly.
      setStatus('Saving revision order…')
      const rows = (r.lines || []).filter((l) => l.include !== false).map((l) => ({ desc: l.printDesc || l.desc, kind: l.printKind || 'Modify', amount: l.printAmount != null ? l.printAmount : l.amount }))
      const adj = revisionReconcile(rows, money.net)
      if (adj) rows.push({ desc: REVISION_ADJ_LABEL, kind: 'Modify', amount: adj })
      const num = makeRevisionOrderNumber(original)
      // The Revised Contract's number: the ORIGINAL agreement's + " Rev <n>" (lib/contractDocs).
      const revNo = r.revNo || '1'
      const agreementNo = agreementRootOf(original)
      const ctNo = revisedContractNumber(original, revNo)
      const signedOrig = isSold(original.status)
      const noteTxt = [r.note, `Revised order: quote #${cur.quote_number || '—'} (revises ${signedOrig ? 'signed quote' : 'quote (not signed yet)'} #${original.quote_number || '—'}).`].filter(Boolean).join(' ')
      const html = buildRevisionHtml({
        client, quote: original,
        revision: {
          number: num, revNo, date: r.date, rows, original: r.signed.total, contractNo: ctNo,
          originalLabel: signedOrig ? null : 'Original Quote Price (not signed yet)',
          additions: money.additions, credits: money.credits, revised: money.total,
          origDeposit: paid || null, newDeposit: money.deposit, newBalance: bal.balance, refund: bal.refund, note: noteTxt,
        },
      })
      try {
        const blob = await renderQuotePdf(html)
        await uploadClientDocBlob(client.id, 'revisions', blob, `${num}.pdf`, 'application/pdf')
        window.dispatchEvent(new CustomEvent('ss:docs-updated', { detail: { clientId: client.id } }))
      } catch (e) {
        console.warn('revision order upload failed', e)
        toast('The Revision Order PDF could not be saved to Documents: ' + escHtml(e.message || e))
      }

      // 2) This quote = the active order at the revised price, linked to the signed quote.
      setStatus('Updating the quote…')
      const at = new Date().toISOString()
      const upd = await harvestRevisionUpdate({ pg, buildWin: iframeRef.current?.contentWindow, initialQuote: cur, setStatus })
      if (Math.abs(Number(upd.total_amount) - money.total) >= 0.005) console.warn('revised total on the card differs from the revision', upd.total_amount, money.total)
      upd.status = orderStatus
      upd.parent_quote_id = original.id
      upd.payload_json = {
        ...upd.payload_json,
        revisionOf: {
          id: original.id, quote_number: original.quote_number || null, signed_total: r.signed.total, signed_deposit: r.signed.deposit, paid_before: paid, paid_total: r2(Math.max(paid, money.deposit)),
          revised_total: money.total, revision_order: num, rev_no: revNo, mode: r.mode, at,
          agreement_number: agreementNo, contract_number: ctNo, signed: signedOrig, signed_contract: r.repSigned === true || signedContractOf(original),
        },
      }
      const savedRow = await save(upd, cur)
      quoteRef.current = mergeSaved(cur, upd)
      if (savedRow && savedRow.payload_json && savedRow.id === cur.id) quoteRef.current = { ...quoteRef.current, payload_json: savedRow.payload_json }

      // 3) The signed quote: 'superseded' (base enum — no migration needed), linked
      //    to this one; its card shows "Replaced by #<this quote>". It is no longer
      //    an active order (not sold, not open), so nothing counts it twice.
      const link = { id: cur.id || null, quote_number: cur.quote_number || null, revision_order: num, revised_total: money.total, at, contract_number: ctNo, rev_no: revNo }
      // the original's payload as it is NOW in the database (a signed day typed a moment ago — "When did he
      // sign?" — or a mark set in Documents while this window was open must not be written over; review 10/19/26)
      let livePayload = original.payload_json || {}
      try {
        const { data: lv } = await supabase.from('quotes').select('payload_json').eq('id', original.id).single()
        const lr = Array.isArray(lv) ? lv[0] : lv
        if (lr && lr.payload_json && typeof lr.payload_json === 'object') livePayload = lr.payload_json
      } catch { /* the window's copy */ }
      const prev = Array.isArray(livePayload.revisions) ? livePayload.revisions : []
      // a redo (owner 10/19/26): the unsigned revision(s) it replaces are flagged, so their number is reused
      const redoIds = (r.redo?.ids || []).filter((id) => id && id !== cur.id)
      const origPayload = { ...livePayload, revisedBy: link, revisions: [...revisionsAfterRedo(prev, [...(r.redo?.ids || []), ...(r.redo?.dropped || [])]), link] }
      let origMark = 'superseded'
      try {
        const { error } = await supabase.from('quotes').update({ status: 'superseded', payload_json: origPayload }).eq('id', original.id)
        if (error) {
          origMark = 'failed'
          console.warn('original not marked superseded', error)
          toast(`Quote #${escHtml(original.quote_number)} could not be marked as replaced: ${escHtml(error.message)}`)
        }
      } catch (e) { origMark = 'failed'; console.warn('original not marked superseded', e) }
      // A redo: the unsigned revision(s) it replaces stop being an order ("Replaced by #<this quote>"),
      // so the lead never has two active orders (and nothing is counted twice).
      let redoneN = 0, redoneStar = false
      for (const id of redoIds) {
        try {
          const { data: rr } = await supabase.from('quotes').select('payload_json, starred').eq('id', id).single()
          const row = Array.isArray(rr) ? rr[0] : rr
          if (row && row.starred === true) redoneStar = true
          const { error } = await supabase.from('quotes').update({ status: 'superseded', payload_json: { ...((row && row.payload_json) || {}), revisedBy: link, redoneBy: link } }).eq('id', id)
          if (error) toast(`An earlier unsigned revision could not be retired: ${escHtml(error.message)}`)
          else redoneN++
        } catch (e) { console.warn('redone revision not retired', e) }
      }
      // The star (the lead's current quote, Open Layout) moves to the active order.
      // Best effort: without migration 019 there is no starred column.
      if (redoneStar && cur.id) {
        try {
          const { error: s0 } = await supabase.from('quotes').update({ starred: false }).in('id', redoIds)
          if (!s0) await supabase.from('quotes').update({ starred: true }).eq('id', cur.id)
        } catch (e) { console.warn('star not moved', e) }
      }
      if (original.starred === true && cur.id) {
        try {
          const { error: s1 } = await supabase.from('quotes').update({ starred: false }).eq('id', original.id)
          if (!s1) await supabase.from('quotes').update({ starred: true }).eq('id', cur.id)
        } catch (e) { console.warn('star not moved', e) }
      }

      // 4) Revised Contract from the held build (changes highlighted, the signed
      //    deposit shown as paid, additional deposit due, new balance).
      try { pg._rvForce = true } catch { /* ignore */ }
      // what changed, line by line, for the REVISED CONTRACT box / row tags / payment path
      const rvDoc = revisionDocFor({ original, lines: r.lines, revNo, originalTotal: r.signed.total, depositPaid: paid, adjustment: adj, adjLabel: REVISION_ADJ_LABEL, agreementNo, agreementSignedDate: agrDay })
      try { await saveContractThenPrint(pg, { confirmed: true, number: ctNo, rvDoc }) } finally { try { pg._rvForce = false } catch { /* ignore */ } }
      toast(`Revised contract ${escHtml(ctNo || '')} created at ${fmtMoney(money.total)} (${signedOrig ? 'signed' : 'original quote'} ${fmtMoney(r.signed.total)} ${money.net >= 0 ? '+' : '−'} ${fmtMoney(Math.abs(money.net))}). ${origMark === 'superseded' ? `#${escHtml(original.quote_number)} is marked replaced by #${escHtml(cur.quote_number || '')}; this` : 'The signed quote could not be updated; this'} quote is the active order.${redoneN ? ` Revision ${escHtml(revNo)} redone: ${redoneN} unsigned revision${redoneN === 1 ? '' : 's'} retired.` : ''}`, 'success')
    } catch (e) {
      console.warn('use as revision failed', e)
      toast('Use as Revision failed: ' + escHtml(e.message || e))
    } finally {
      setStatus('')
      savingRef.current = false
      refreshBanner()
    }
  }

  // Hook the program's GENERATE CONTRACT button so it also saves to the Doc Hub.
  // Capture-phase + stopImmediatePropagation blocks the inline onclick so it
  // doesn't also fire (which would double-open and race the silent capture).
  useEffect(() => {
    const tick = () => {
      const pg = getProgramWindow()
      if (!pg || !pg.document) return
      const btns = [...pg.document.querySelectorAll('button')].filter((b) =>
        /printContract/.test(b.getAttribute('onclick') || '') || /generate contract/i.test(b.textContent || ''),
      )
      btns.forEach((b) => {
        if (b.dataset.ssContractHooked === '1') return
        b.dataset.ssContractHooked = '1'
        b.removeAttribute('onclick')
        b.onclick = null
        b.addEventListener('click', (e) => { e.preventDefault(); e.stopImmediatePropagation(); contractRef.current(getProgramWindow()) }, true)
      })
      // the desktop app's Save dialog name (owner 10/19/26: "it should write like 'Peter Mawn-StormSafe Steel Revised
      // Contract (10.19)'"): the program names every contract "… CONTRACT (m.d)" and takes its own window.electronAPI
      // first, so a shim there renames by what the document IS and hands everything else through
      const real = window.electronAPI
      if (real && typeof real.savePdf === 'function' && !pg.__ssPdfNameShim) {
        const shim = {}
        for (const k in real) shim[k] = typeof real[k] === 'function' ? (...a) => real[k](...a) : real[k]
        shim.savePdf = (html, name, ...rest) => real.savePdf(html, pdfNameFor(html, name), ...rest)
        try { pg.electronAPI = shim; pg.__ssPdfNameShim = true } catch { /* ignore */ }
      }
      // the program's own "Executed Copy — Deposit Paid" button: saved to Documents + the quote marked
      // Deposit Paid, exactly like the Doc Hub stamp (saveExecutedThenPrint)
      ;[...pg.document.querySelectorAll('button')].filter((b) => /printExecutedCopy/.test(b.getAttribute('onclick') || '')).forEach((b) => {
        if (b.dataset.ssExecHooked === '1') return
        b.dataset.ssExecHooked = '1'
        b.removeAttribute('onclick')
        b.onclick = null
        b.addEventListener('click', (e) => { e.preventDefault(); e.stopImmediatePropagation(); execRef.current(getProgramWindow()) }, true)
      })
    }
    const t = setInterval(tick, 600)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const barTone = blocked ? (banner?.tone === 'error' ? 'error' : 'warn') : banner?.tone
  // a saved quote in hand (reopened, or saved in this session): Update Quote ▾
  const hasQuote = !!curQuote?.id
  const curNo = curQuote?.quote_number || null
  const newBlock = hasQuote ? saveAsNewBlocker({ original: quoteRef.current, revisionChanges }) : null
  const barTitle = hasQuote ? `Editing Quote${curNo ? ` #${curNo}` : ''}` : restoreData ? 'Editing Quote' : fromDesign ? '3D Builder · from customer design' : '3D Builder'
  const checkWarn = designChecks ? designChecks.items.filter((c) => c.level === 'warn').length : 0
  const checkInfo = designChecks ? designChecks.items.length - checkWarn : 0
  const barClient = client?.name || savedTo
  return (
    <div className="qb-overlay" role="dialog" aria-modal="true" aria-label="3D Builder">
      <div className="qb-modal">
        <div className="qb-bar">
          {/* on a narrow window the title gives way to the buttons (ellipsis); the tooltip keeps it whole */}
          <div className="qb-bar-title" title={barClient ? `${barTitle} · ${barClient}` : barTitle}>
            {barTitle}
            {barClient && <span className="qb-bar-client"> · {barClient}</span>}
          </div>
          {status
            ? <div className="qb-bar-status">{status}</div>
            : <div className="qb-bar-status" style={{ flex: 1, textAlign: 'center', opacity: 0.7 }}>
                {revisionChanges
                  ? <>Place the added components on the building, then hit <b>✓ Finish Revision</b> — saves the Revision Order + Revised Contract.</>
                  : hasQuote
                  ? <>Adjust the build, then <b>Update Quote</b> — or <b>▾ Save as a new quote</b> to keep both versions.</>
                  : fromDesign
                  ? <>Filled in from the customer&rsquo;s design: check the list below, then <b>Save to Lead</b>.</>
                  : client?.id
                    ? <>Build &amp; price, then hit <b>Save to Lead</b> — saves the quote + PDF to this lead.</>
                    : <>Build &amp; price, then hit <b>Save to Lead</b> — attach it to a lead or create a new one.</>}
              </div>}
          <div className="qb-bar-actions">
            {revisionChanges && (
              <button type="button" className="btn-primary" style={{ background: '#f0883e', borderColor: '#f0883e', color: '#161006', fontWeight: 800 }} onClick={finishRevision} disabled={!!status} title="Saves the Revision Order + generates the Revised Contract (renderings, floor plan, spacing sheet) from the build as placed">
                {status || '✓ Finish Revision'}
              </button>
            )}
            <a className="btn-secondary" href={SRC} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>Open in new tab</a>
            <button type="button" className="btn-secondary" onClick={closeBuilder}>Done</button>
            <QuoteStyleToggle getProgramWindow={getProgramWindow} />
            {hasQuote ? (
              <SaveSplitButton
                label={status ? 'Saving…' : '💾 Update Quote'}
                onMain={saveToLead}
                disabled={!!status}
                mainStyle={SAVE_BTN}
                menuLabel="More save options"
                items={[
                  { id: 'update', label: `Update this quote${curNo ? ` (#${curNo})` : ''}`, hint: 'Saves your changes over this quote', onSelect: saveToLead },
                  { id: 'new', label: 'Save as a new quote', tone: 'accent', hint: `Keeps ${curNo ? '#' + curNo : 'this quote'} exactly as it is — your changes become a new quote (today’s pricing)`, disabled: !!newBlock, disabledReason: newBlock, onSelect: saveAsNew },
                  { id: 'done', label: 'Done — close without saving', hint: 'Asks first if something changed', onSelect: closeBuilder },
                ]}
              />
            ) : (
              <button type="button" className="btn-primary" style={SAVE_BTN} onClick={saveToLead} disabled={!!status}>{status ? 'Saving…' : '💾 Save to Lead'}</button>
            )}
          </div>
        </div>
        {designChecks && (
          <div className={`qb-lock ${checkWarn ? 'qb-lock-warn' : 'qb-lock-ok'} qb-design-checks`} role="region" aria-label="Check these before quoting">
            <span className="qb-lock-dot" aria-hidden="true" />
            <span className="qb-lock-text">
              <b>Check these before quoting</b> — filled in from {fromDesign?.name || 'the customer'}&rsquo;s design (CCI, today&rsquo;s pricing): {checkWarn} to check{checkInfo ? `, ${checkInfo} to know` : ''}. Nothing is saved until you Save to Lead.
            </span>
            <button type="button" className="btn-secondary qb-lock-btn" aria-expanded={designChecks.open} onClick={() => setDesignChecks((c) => (c ? { ...c, open: !c.open } : c))}>{designChecks.open ? 'Hide' : 'Show'}</button>
            {designChecks.open && (
              <ul className="qb-design-list">
                {designChecks.items.map((c, i) => (
                  <li key={i} className={c.level === 'warn' ? 'qb-design-warn' : 'qb-design-info'}>
                    <span className="qb-design-tag">{c.level === 'warn' ? 'Check' : 'Note'}</span>{c.text}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {pendingContract && (
          <div className="qb-lock qb-lock-save" role="status" aria-live="polite">
            <span className="qb-lock-dot" aria-hidden="true" />
            <span className="qb-lock-text">Contract <b>{pendingContract.num}</b> is open to look at — it is <b>not</b> in the Doc Hub yet. Happy with it?</span>
            <button type="button" className="btn-primary qb-lock-btn" onClick={savePendingContract} disabled={!!status}>Save to Doc Hub</button>
            <button type="button" className="btn-secondary qb-lock-btn" onClick={() => setPendingContract(null)} disabled={!!status} title="Leave it out of the Doc Hub">Not this one</button>
          </div>
        )}
        {(banner || blocked) && (
          <div className={`qb-lock qb-lock-${barTone || 'warn'}`} role="status" aria-live="polite">
            <span className="qb-lock-dot" aria-hidden="true" />
            <span className="qb-lock-text">
              {banner?.text}
              {banner?.detail && <span className="qb-lock-detail"> — {banner.detail}</span>}
              {blocked && <span className="qb-lock-blocked">{banner ? ' · ' : ''}{AUTO_LABEL[blocked.kind]} not run automatically: {blocked.reason}</span>}
            </span>
            {blocked && (
              <button type="button" className="btn-secondary qb-lock-btn" onClick={runBlocked} disabled={!!status}>{RUN_LABEL[blocked.kind]}</button>
            )}
          </div>
        )}
        <iframe ref={iframeRef} src={SRC} title="StormSafe 3D Builder" allow="fullscreen" className="qb-iframe" />
      </div>
      {picker && (
        <SaveToLeadPicker
          getProgramWindow={getProgramWindow}
          getBuildWin={() => iframeRef.current?.contentWindow}
          onClose={() => setPicker(false)}
          onSaved={({ clientName, client: c, saved }) => {
            setSavedTo(clientName)
            if (saved && saved.id) { quoteRef.current = saved; markSaved() }
            setPendingContract(null)
            if (c && c.id) {
              setClientState(c)
              // the picker knows only name / phone / email: the full lead row (city, state, zip) prints on the papers
              supabase.from('clients').select('*').eq('id', c.id).single()
                .then(({ data }) => { const row = Array.isArray(data) ? data[0] : data; if (row && row.id === c.id) setClientState(row) })
                .catch(() => {})
            }
          }}
        />
      )}
      {ask && <PriceChangeConfirm check={ask} onAnswer={answer} />}
      {needDay && (
        <MarkSignedModal
          mode="date" clientId={client?.id} quotes={[needDay.node]} presetQuoteId={needDay.node.id} createMark createNumber={needDay.number}
          intro={`Before the revised contract: when did the customer sign ${needDay.number || ('#' + (needDay.node.quote_number || ''))}? The revised contract prints it as the date the agreement was signed. Nothing has been saved yet.`}
          onClose={() => { setNeedDay(null); toast('Revised contract not created — nothing was saved.') }}
          onDone={(res) => { const go = needDay.retry; setNeedDay(null); go(res && res.day) }}
        />
      )}
      {designLink && <DesignLinkModal client={client?.id ? client : null} quote={quoteRef.current || initialQuote || null} onClose={() => setDesignLink(false)} />}
      {uar && (
        <UseAsRevisionModal
          client={client}
          currentQuote={quoteRef.current || initialQuote}
          getProgramWindow={getProgramWindow}
          onClose={() => setUar(false)}
          onManual={(original, info, redo, repSigned) => { setUar(false); setUarManual({ original, info, redo: redo || null, repSigned: !!repSigned }) }}
          onFinish={finishUseAsRevision}
        />
      )}
      {uarManual && (
        <RevisionModal
          client={client}
          quote={uarManual.original}
          revisingWith={(quoteRef.current || initialQuote)?.quote_number || null}
          defaultRevNo={uarManual.redo ? uarManual.redo.revNo : nextRevNo(uarManual.original)}
          onClose={() => setUarManual(null)}
          onUseAsRevision={finishUseAsRevisionManual}
          signed={{ ...uarManual.info.signed, deposit: paidOf(uarManual.original, uarManual.info.signed.deposit) }}
          revisionPreview={(dSub) => { try { const m = uarManual.info.forward(r2(Number(uarManual.info.signed.sub) + dSub)); return { total: r2(m.adjTot), deposit: r2(m.dep), balance: r2(m.bal) } } catch { return null } }}
        />
      )}
    </div>
  )
}
