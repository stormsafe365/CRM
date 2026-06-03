// LayoutTool: the global "2D Layout" tab. Embeds the Building Approval Sheet
// (same-origin /layout-sheet.html) full-width so reps can lay out a building,
// sign, and print/export the approval sheet. For client sign-offs, open it from
// a specific lead (Document Hub → Open Layout) so the PDF attaches to them.

import { toast } from '../lib/uiFx'

export default function LayoutTool() {
  return (
    <>
      <div className="page-head">
        <div className="left">
          <div className="eyebrow-lime">Sign-Off</div>
          <h1>2D Layout</h1>
          <div className="sub">Place doors, windows, roll-ups &amp; framed openings on a dimensioned plan, then sign and print the approval sheet.</div>
        </div>
        <div className="right">
          <a className="btn btn-ghost" href="/layout-sheet.html" target="_blank" rel="noreferrer">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><path d="M15 3h6v6M10 14 21 3" /></svg>
            Open in new tab
          </a>
          <button className="btn btn-ghost" onClick={() => toast('Desktop Layout Builder: run the layout-builder app on your machine for heavy editing. Sign-offs done here attach to the lead.')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" /></svg>
            Desktop editor
          </button>
        </div>
      </div>

      <section className="tile" style={{ padding: 0, overflow: 'hidden' }}>
        <iframe
          src="/layout-sheet.html"
          title="StormSafe Building Approval Sheet"
          style={{ width: '100%', height: 'calc(100vh - 210px)', minHeight: 560, border: 0, display: 'block', background: 'var(--bg)' }}
        />
      </section>
    </>
  )
}
