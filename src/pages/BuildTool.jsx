// BuildTool: the "3D Builder" tab. Embeds the StormSafe parametric configurator
// (price program + live 3D) full-bleed via same-origin /build/build.html. The
// builder is its own app (its dist is synced into public/build/ — see the
// "sync:builder" script); this page just hosts the latest build so quoting +
// rendering live in the CRM. Renders edge-to-edge (AppLayout drops the canvas
// max-width + padding for /build) with only a slim action bar on top.

import { toast } from '../lib/uiFx'

export default function BuildTool() {
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
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <a className="btn btn-ghost" href="/build/build.html" target="_blank" rel="noreferrer">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><path d="M15 3h6v6M10 14 21 3" /></svg>
            Open in new tab
          </a>
          <button className="btn btn-ghost" onClick={() => toast('Saving a build to a lead is coming next — for now, finish the quote here and attach it from the lead’s Document Hub.')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><path d="M17 21v-8H7v8M7 3v5h8" /></svg>
            Save to lead
          </button>
        </div>
      </div>

      <iframe
        src="/build/build.html"
        title="StormSafe 3D Builder"
        allow="fullscreen"
        style={{ flex: 1, width: '100%', minHeight: 0, border: 0, display: 'block', background: '#08121d' }}
      />
    </div>
  )
}
