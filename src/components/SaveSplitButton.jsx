// SaveSplitButton: the Build Quote modal's save button when a saved quote is open (owner 10/24/26: "when editing a
// saved quote ... the Update Quote button [should] become a dropdown with: Update quote, Save as new quote, Done").
// The main part does what it always did (Update Quote); the caret opens a small menu of the other choices.
// Keyboard: Enter / Space / ArrowDown on the caret open it (ArrowUp from the bottom), ArrowUp / ArrowDown / Home /
// End move, Enter / Space pick, Esc closes back to the caret, Tab moves on. A click outside — or into the builder
// (the page loses focus to the iframe) — closes it.

import { useEffect, useId, useRef, useState } from 'react'

export default function SaveSplitButton({ label, onMain, disabled = false, mainStyle = undefined, items = [], menuLabel = 'More save options' }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)
  const caretRef = useRef(null)
  const itemRefs = useRef([])
  const focusAt = useRef(null)
  const menuId = useId()

  const close = (toCaret) => {
    setOpen(false)
    if (toCaret) { try { caretRef.current?.focus() } catch { /* ignore */ } }
  }
  const openAt = (where) => { if (disabled) return; focusAt.current = where; setOpen(true) }

  useEffect(() => {
    if (!open) return undefined
    const els = itemRefs.current.filter(Boolean)
    const target = focusAt.current === 'last' ? els[els.length - 1] : els[0]
    try { target?.focus() } catch { /* ignore */ }
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
    const onBlur = () => setOpen(false) // focus went into the builder iframe (its clicks never reach this page)
    document.addEventListener('mousedown', onDown, true)
    window.addEventListener('blur', onBlur)
    window.addEventListener('resize', onBlur)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('resize', onBlur)
    }
  }, [open])
  useEffect(() => { if (disabled && open) setOpen(false) }, [disabled, open])

  const onCaretKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); openAt('first') }
    else if (e.key === 'ArrowUp') { e.preventDefault(); openAt('last') }
    else if (e.key === 'Escape' && open) { e.preventDefault(); close(true) }
  }
  const onMenuKey = (e) => {
    const els = itemRefs.current.filter(Boolean)
    const i = els.indexOf(document.activeElement)
    const go = (n) => { e.preventDefault(); try { els[(n + els.length) % els.length]?.focus() } catch { /* ignore */ } }
    if (e.key === 'ArrowDown') go(i + 1)
    else if (e.key === 'ArrowUp') go(i < 0 ? els.length - 1 : i - 1)
    else if (e.key === 'Home') go(0)
    else if (e.key === 'End') go(els.length - 1)
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true) }
    else if (e.key === 'Tab') setOpen(false)
  }
  const pick = (it) => {
    if (it.disabled) return
    close(false)
    try { it.onSelect && it.onSelect() } catch (err) { console.warn('save menu', err) }
  }

  itemRefs.current = []
  return (
    <div className={`qb-split${open ? ' is-open' : ''}`} ref={wrapRef}>
      <button type="button" className="btn-primary qb-split-main" style={mainStyle} onClick={onMain} disabled={disabled}>{label}</button>
      <button
        type="button" ref={caretRef} className="btn-primary qb-split-caret" style={mainStyle} disabled={disabled}
        aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined} aria-label={menuLabel} title={menuLabel}
        onClick={() => (open ? close(false) : openAt('first'))} onKeyDown={onCaretKey}
      >
        <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open && (
        <div className="qb-split-menu" role="menu" id={menuId} aria-label={menuLabel} onKeyDown={onMenuKey}>
          {items.map((it, i) => (
            <button
              key={it.id} type="button" role="menuitem" tabIndex={-1}
              ref={(el) => { itemRefs.current[i] = el }}
              className={`qb-split-item${it.tone ? ' qb-split-' + it.tone : ''}${it.disabled ? ' is-disabled' : ''}`}
              aria-disabled={it.disabled ? 'true' : undefined}
              data-act={it.id}
              onClick={() => pick(it)}
            >
              <span className="qb-split-label">{it.label}</span>
              {(it.disabled ? it.disabledReason : it.hint) && <span className="qb-split-hint">{it.disabled ? it.disabledReason : it.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
