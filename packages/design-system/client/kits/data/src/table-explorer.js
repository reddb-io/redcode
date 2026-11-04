function filterTableRows(rows, filters) {
  const active = Object.entries(filters).filter(([, term]) => term.trim());
  return rows.filter(
    (row) => active.every(
      ([key, term]) => row[key] != null && String(row[key]).toLowerCase().includes(term.toLowerCase())
    )
  );
}
function explorerTableColumns(columns, rows) {
  let key = "__explorer_row_number__";
  while (columns.some((column) => column.key === key) || rows.some((row) => key in row))
    key += "_";
  return [
    {
      key,
      header: "#",
      align: "end",
      editable: false,
      format: (_, row) => String(rows.indexOf(row) + 1)
    },
    ...columns
  ];
}
function tableQueryRequest(columns, limit) {
  return {
    columns: [...new Set(columns)],
    limit: Number.isFinite(limit) ? Math.max(1, Math.min(1e3, Math.floor(limit))) : 200
  };
}
function renderTableSnapshot(columns, rows) {
  const lines = [];
  lines.push("<table>");
  lines.push("<thead><tr>");
  lines.push('<th class="num">#</th>');
  for (const c of columns) {
    const kind = c.identity;
    const mark = c.badge ? `<span class="badge ${c.badge === "sys" ? "sys" : "pk"}">${escapeHtml(c.badge)}</span>` : "";
    const cls = kind ? ` class="id ${escapeHtml(kind)}"` : "";
    lines.push(`<th${cls}>${escapeHtml(c.key)}${mark}</th>`);
  }
  lines.push("</tr></thead>");
  lines.push("<tbody>");
  rows.forEach((row, i) => {
    lines.push("<tr>");
    lines.push(`<td class="num">${i + 1}</td>`);
    for (const c of columns) {
      const v = row[c.key];
      const kind = c.identity;
      const cls = kind ? ` class="id ${escapeHtml(kind)}"` : "";
      if (v === null || v === void 0) {
        lines.push(`<td${cls}><span class="null">NULL</span></td>`);
      } else {
        lines.push(
          `<td${cls}><span class="cell">${escapeHtml(truncateTableValue(typeof v === "object" ? JSON.stringify(v) : String(v)))}</span></td>`
        );
      }
    }
    lines.push("</tr>");
  });
  lines.push("</tbody>");
  lines.push("</table>");
  return lines.join("");
}
function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function truncateTableValue(value) {
  return value.length <= 64 ? value : value.slice(0, 63) + "\u2026";
}
export {
  explorerTableColumns,
  filterTableRows,
  renderTableSnapshot,
  tableQueryRequest
};
