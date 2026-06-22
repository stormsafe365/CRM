// BuildQuoteModal: opens the StormSafe 3D Builder (parametric configurator +
// pricing) full-screen for a specific lead, served same-origin at
// /build/build.html. This is the primary "Build Quote" tool.
//
// Note: the builder is its own bundled app and doesn't yet expose a capture API,
// so the quote isn't auto-saved back to the CRM. Finish + price the build here,
// then attach the quote/PDF from the lead's Document Hub. (Auto-save to the lead
// can be wired once the builder exposes a save hook.)

export default function BuildQuoteModal({ client, onClose }) {
  return (
    <div className="qb-overlay" role="dialog" aria-modal="true" aria-label="3D Builder">
      <div className="qb-modal">
        <div className="qb-bar">
          <div className="qb-bar-title">
            3D Builder
            {client?.name && <span className="qb-bar-client"> · {client.name}</span>}
          </div>
          <div className="qb-bar-status" style={{ flex: 1, textAlign: 'center', opacity: 0.7 }}>
            Build &amp; price here, then attach the quote/PDF under the lead’s Document Hub.
          </div>
          <div className="qb-bar-actions">
            <a className="btn-secondary" href="/build/build.html" target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
              Open in new tab
            </a>
            <button type="button" className="btn-primary" onClick={onClose}>Done</button>
          </div>
        </div>
        <iframe src="/build/build.html" title="StormSafe 3D Builder" allow="fullscreen" className="qb-iframe" />
      </div>
    </div>
  )
}
