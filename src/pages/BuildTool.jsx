// BuildTool: the "3D Builder" tab. Embeds the StormSafe parametric configurator
// (price program + live 3D) full-bleed via same-origin /build/build.html. The
// builder is its own app (its dist is synced into public/build/ — see the
// "sync:builder" script); this page just hosts the latest build so quoting +
// rendering live in the CRM. Renders edge-to-edge (AppLayout drops the canvas
// max-width + padding for /build) with only a slim action bar on top.
//
// "Save to lead" here works WITHOUT starting from a lead page: it opens the
// shared SaveToLeadPicker to attach the quote to an existing lead OR create a
// new one on the spot (prefilled from whatever was typed into the builder's
// own Client Information section).

import { useEffect, useMemo, useRef, useState } from 'react'
import SaveToLeadPicker from '../components/SaveToLeadPicker'
import DesignLinkModal from '../components/DesignLinkModal'
import QuoteStyleToggle from '../components/QuoteStyleToggle'
import { toast } from '../lib/uiFx'

export default function BuildTool() {
  // Cache-bust build.html per tab-open so a freshly synced builder shows up
  // without a hard refresh (the iframe otherwise serves a stale cached copy).
  const buildSrc = useMemo(() => `/build/build.html?v=${Date.now()}`, [])
  const iframeRef = useRef(null)
  const [picker, setPicker] = useState(false)
  const [designLink, setDesignLink] = useState(false)

  // The program's SEND DESIGN LINK button (owner 10/16/26) calls window.__ssSendDesignLink.
  // No lead here: the dialog asks which lead the link is for.
  useEffect(() => {
    const hook = () => setDesignLink(true)
    window.__ssSendDesignLink = hook
    return () => { if (window.__ssSendDesignLink === hook) delete window.__ssSendDesignLink }
  }, [])

  // The QTEPRO program lives in build.html's LEFT-pane iframe (same-origin).
  function getProgramWindow() {
    try {
      const inner = iframeRef.current?.contentWindow?.document?.querySelector('iframe')
      const pg = inner?.contentWindow
      return pg && typeof pg.collectQuoteData === 'function' ? pg : null
    } catch { return null }
  }

  function openPicker() {
    if (!getProgramWindow()) { toast('The builder is still loading — give it a moment and try again.'); return }
    setPicker(true)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* Slim action bar — the builder has its own header, so keep this minimal. */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '10px 16px', borderBottom: '1px solid var(--line-soft)',
        background: 'linear-gradient(180deg, #0A1521, #08121D)', flex: '0 0 auto',
      }}>
        <div className="eyebrow-lime" style={{ margin: 0 }}>Price + Render</div>
        <h1 style={{ margin: 0, fontSize: 18, lineHeight: 1 }}>3D Builder</h1>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <a className="btn btn-ghost" href="/build/build.html" target="_blank" rel="noreferrer">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><path d="M15 3h6v6M10 14 21 3" /></svg>
            Open in new tab
          </a>
          {/* the quote PDF's style (Dark / White) — the program's own choice, followed by Save to lead's PDF */}
          <QuoteStyleToggle getProgramWindow={getProgramWindow} />
          <button className="btn btn-ghost" onClick={openPicker}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><path d="M17 21v-8H7v8M7 3v5h8" /></svg>
            Save to lead
          </button>
        </div>
      </div>

      <iframe
        ref={iframeRef}
        src={buildSrc}
        title="StormSafe 3D Builder"
        allow="fullscreen"
        style={{ flex: 1, width: '100%', minHeight: 0, border: 0, display: 'block', background: '#08121d' }}
      />

      {picker && (
        <SaveToLeadPicker
          getProgramWindow={getProgramWindow}
          getBuildWin={() => iframeRef.current?.contentWindow}
          onClose={() => setPicker(false)}
        />
      )}
      {designLink && <DesignLinkModal onClose={() => setDesignLink(false)} />}
    </div>
  )
}
