/* ============================================================
   Schedule.jsx — opening schedule table
   ============================================================ */

function Schedule({ building, openings, tagMap }) {
  // sort by tag number for stable reading order
  const rows = openings.slice().sort((a, b) => tagMap[a.id] - tagMap[b.id]);

  // The number names the SAME end as the quote program's spacing page
  // (scheduleOffset in data.js); the plan's own reference corners are unchanged.
  function offsetText(op) {
    const s = scheduleOffset(op, building);
    return { near: ftInTight(s.value), ref: s.ref };
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
        {notesFoot(building)}
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
      {notesFoot(building)}
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

// Quote items the plan can't draw (lean-tos, storage-partition openings, open
// walls) — seeded from the CRM quote (building.notes), listed under the schedule.
function notesFoot(building) {
  const notes = (building && Array.isArray(building.notes)) ? building.notes.filter(Boolean) : [];
  if (!notes.length) return null;
  return (
    <tbody className="sched-notes">
      {notes.map((n, i) => (
        <tr key={'n' + i}>
          <td colSpan="6" style={{ color: 'var(--navy-900)', fontSize: '12px', padding: '5px 10px' }}>
            <span style={{ color: 'var(--fg-3)', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', fontSize: '10px', marginRight: '8px' }}>Note</span>{n}
          </td>
        </tr>
      ))}
    </tbody>
  );
}

function countByType(openings) {
  const counts = {};
  openings.forEach(o => { counts[o.type] = (counts[o.type] || 0) + 1; });
  const parts = TYPE_ORDER.filter(k => counts[k]).map(k => `${counts[k]}× ${OPENING_TYPES[k].label}`);
  return parts.join('   ·   ');
}

window.Schedule = Schedule;
