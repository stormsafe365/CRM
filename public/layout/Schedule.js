function Schedule({ building, openings, tagMap }) {
  const rows = openings.slice().sort((a, b) => tagMap[a.id] - tagMap[b.id]);
  function offsetText(op) {
    const wl = wallLength(op.wall, building);
    const far = wl - op.offset - op.w;
    const refCorner = WALLS[op.wall].ref;
    return { near: ftInTight(op.offset), far: ftInTight(far < 0 ? 0 : far), ref: refCorner };
  }
  if (!rows.length) {
    return /* @__PURE__ */ React.createElement("table", { className: "sched" }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("th", { className: "tagcell" }, "#"), /* @__PURE__ */ React.createElement("th", null, "Type"), /* @__PURE__ */ React.createElement("th", null, "Wall"), /* @__PURE__ */ React.createElement("th", null, "Size (W \xD7 H)"), /* @__PURE__ */ React.createElement("th", null, "Offset from corner"), /* @__PURE__ */ React.createElement("th", null, "Notes"))), /* @__PURE__ */ React.createElement("tbody", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", { colSpan: "6", style: { textAlign: "center", color: "var(--fg-3)", padding: "20px" } }, "No openings placed yet."))));
  }
  return /* @__PURE__ */ React.createElement("table", { className: "sched" }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("th", { className: "tagcell" }, "#"), /* @__PURE__ */ React.createElement("th", null, "Type"), /* @__PURE__ */ React.createElement("th", null, "Wall"), /* @__PURE__ */ React.createElement("th", null, "Size (W \xD7 H)"), /* @__PURE__ */ React.createElement("th", null, "Offset to corner"), /* @__PURE__ */ React.createElement("th", null, "Notes"))), /* @__PURE__ */ React.createElement("tbody", null, rows.map((op) => {
    const t = OPENING_TYPES[op.type];
    const o = offsetText(op);
    const label = op.name && op.name.trim() ? op.name.trim() : t.label;
    const notes = [];
    if (op.note && op.note.trim()) notes.push(op.note.trim());
    return /* @__PURE__ */ React.createElement("tr", { key: op.id }, /* @__PURE__ */ React.createElement("td", { className: "tagcell" }, /* @__PURE__ */ React.createElement("span", { className: "tag", style: { background: t.color } }, tagMap[op.id])), /* @__PURE__ */ React.createElement("td", { className: "typecell" }, label), /* @__PURE__ */ React.createElement("td", null, WALLS[op.wall].label), /* @__PURE__ */ React.createElement("td", { className: "mono" }, sizeLabel(op)), /* @__PURE__ */ React.createElement("td", { className: "mono" }, o.near, " ", /* @__PURE__ */ React.createElement("span", { style: { color: "var(--fg-3)" } }, "from ", o.ref)), /* @__PURE__ */ React.createElement("td", { style: { color: notes.length ? "var(--navy-900)" : "var(--fg-3)" } }, notes.length ? notes.join(" \xB7 ") : "\u2014"));
  })), /* @__PURE__ */ React.createElement("tfoot", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", { colSpan: "3" }, rows.length, " opening", rows.length === 1 ? "" : "s", " total"), /* @__PURE__ */ React.createElement("td", { colSpan: "3", style: { textAlign: "right" } }, countByType(openings)))));
}
function countByType(openings) {
  const counts = {};
  openings.forEach((o) => {
    counts[o.type] = (counts[o.type] || 0) + 1;
  });
  const parts = TYPE_ORDER.filter((k) => counts[k]).map((k) => `${counts[k]}\xD7 ${OPENING_TYPES[k].label}`);
  return parts.join("   \xB7   ");
}
window.Schedule = Schedule;
