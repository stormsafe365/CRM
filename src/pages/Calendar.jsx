// Calendar: the Follow-Up HQ — the richer follow-up tracker (stages, reps,
// reminders) embedded same-origin at /follow-up-hq.html. It keeps its own data
// in the app's local storage; the stable Electron port keeps that persistent.

export default function Calendar() {
  return (
    <>
      <div className="page-head">
        <div className="left">
          <div className="eyebrow-lime">Schedule</div>
          <h1>Follow-Up HQ</h1>
          <div className="sub">Track everyone by stage, with reminders and reps — all in one place.</div>
        </div>
        <div className="right">
          <a className="btn btn-ghost" href="/follow-up-hq.html" target="_blank" rel="noreferrer">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><path d="M15 3h6v6M10 14 21 3" /></svg>
            Open in new tab
          </a>
        </div>
      </div>

      <section className="tile" style={{ padding: 0, overflow: 'hidden' }}>
        <iframe
          src="/follow-up-hq.html"
          title="StormSafe Follow-Up HQ"
          style={{ width: '100%', height: 'calc(100vh - 200px)', minHeight: 600, border: 0, display: 'block', background: 'var(--bg)' }}
        />
      </section>
    </>
  )
}
