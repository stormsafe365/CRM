/* ============================================================
   Schedule.jsx — opening schedule table
   ============================================================ */

function Schedule({ building, openings, tagMap }) {
  // sort by tag number for stable reading order
  const rows = openings.slice().sort((a, b) => tagMap[a.id] - tagMap[b.id]);

  function offsetText(op) {
    const wl = wallLength(op.wall, building);
    const far = wl - op.offset - op.w;
    const refCorner = WALLS[op.wall].ref;
    return { near: ftInTight(op.offset), far: ftInTight(far < 0 ? 0 : far), ref: refCorner };
  }

  if (!rows.length) {
    return (
      <table className="sched">
        <thead>
          <tr><th className="tagcell">#</th><th>Type</th><th>Wall</th><th>Size (W × H)</th><th>Offset from corner</th><th>Notes</th></tr>
        </thead>
        <tbody>
          <tr><td colSpan="6" style={{ textAlign: 'center', color: 'var(--fg-3)', padding: '20px' }}>No openings placed yet.</td></tr>
        </tbody>
      </table>
    );
  }

  return (
    <table className="sched">
      <thead>
        <tr>
          <th className="tagcell">#</th>
          <th>Type</th>
          <th>Wall</th>
          <th>Size (W × H)</th>
          <th>Offset to corner</th>
          <th>Notes</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(op => {
          const t = OPENING_TYPES[op.type];
          const o = offsetText(op);
          const label = op.name && op.name.trim() ? op.name.trim() : t.label;
          const notes = [];
          if (op.note && op.note.trim()) notes.push(op.note.trim());
          return (
            <tr key={op.id}>
              <td className="tagcell">
                <span className="tag" style={{ background: t.color }}>{tagMap[op.id]}</span>
              </td>
              <td className="typecell">{label}</td>
              <td>{WALLS[op.wall].label}</td>
              <td className="mono">{sizeLabel(op)}</td>
              <td className="mono">{o.near} <span style={{ color: 'var(--fg-3)' }}>from {o.ref}</span></td>
              <td style={{ color: notes.length ? 'var(--navy-900)' : 'var(--fg-3)' }}>{notes.length ? notes.join(' · ') : '—'}</td>
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan="3">{rows.length} opening{rows.length === 1 ? '' : 's'} total</td>
          <td colSpan="3" style={{ textAlign: 'right' }}>
            {countByType(openings)}
          </td>
        </tr>
      </tfoot>
    </table>
  );
}

function countByType(openings) {
  const counts = {};
  openings.forEach(o => { counts[o.type] = (counts[o.type] || 0) + 1; });
  const parts = TYPE_ORDER.filter(k => counts[k]).map(k => `${counts[k]}× ${OPENING_TYPES[k].label}`);
  return parts.join('   ·   ');
}

window.Schedule = Schedule;
