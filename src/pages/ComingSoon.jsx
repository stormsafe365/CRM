// Placeholder for nav destinations that aren't built yet. Keeps the
// sidebar complete and honest — clicking lands here instead of a dead link.

export default function ComingSoon({ title, blurb }) {
  return (
    <>
      <div className="page-header">
        <div>
          <h1>{title}</h1>
          <p className="muted">{blurb}</p>
        </div>
      </div>
      <div className="empty-state" style={{ padding: '54px 20px' }}>
        <div style={{ fontFamily: "'Chakra Petch', sans-serif", fontSize: 13, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--cyan)', marginBottom: 10 }}>
          In progress
        </div>
        <div style={{ color: 'var(--txt-2)', maxWidth: 460, margin: '0 auto', lineHeight: 1.6 }}>
          {blurb} This screen is part of the build plan and will light up in an
          upcoming step.
        </div>
      </div>
    </>
  )
}
