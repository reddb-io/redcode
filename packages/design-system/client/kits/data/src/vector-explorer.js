function vectorMagnitude(v) {
  return Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));
}
function scalarLabel(row) {
  if (!row.scalarColumn) return "ranking metric";
  if (/distance/i.test(row.scalarColumn))
    return `search distance \xB7 ${row.scalarColumn}`;
  if (/similarity/i.test(row.scalarColumn))
    return `similarity score \xB7 ${row.scalarColumn}`;
  if (/score/i.test(row.scalarColumn)) return `score \xB7 ${row.scalarColumn}`;
  if (/turbovec|scalar/i.test(row.scalarColumn))
    return `scalar projection \xB7 ${row.scalarColumn}`;
  if (/magnitude|norm/i.test(row.scalarColumn))
    return `vector magnitude \xB7 ${row.scalarColumn}`;
  return `ranking metric \xB7 ${row.scalarColumn}`;
}
function compactValue(v) {
  if (v === null || v === void 0) return "NULL";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
function parseVectorInput(input) {
  const numbers = input.replace(/[\[\]]/g, " ").split(/[,\s]+/).map((part) => part.trim()).filter(Boolean).map(Number);
  if (numbers.length === 0) throw new Error("Paste a numeric vector first.");
  const invalid = numbers.find((n) => !Number.isFinite(n));
  if (invalid !== void 0)
    throw new Error("Vector contains a non-numeric value.");
  return numbers;
}
function filterVectorRows(rows, filter) {
  const term = filter.trim().toLowerCase();
  return rows.filter(
    (row) => !term || row.id.toLowerCase().includes(term) || Object.values(row.metadata).some(
      (value) => compactValue(value).toLowerCase().includes(term)
    )
  );
}
function vectorSearchRequest(kind, input, limit) {
  const count = Math.max(1, Math.min(200, Math.floor(Number(limit) || 20)));
  if (kind === "vector")
    return { kind, vector: parseVectorInput(input), limit: count };
  const text = input.trim();
  if (!text) throw new Error("Enter text to search.");
  return { kind, text, limit: count };
}
function vectorCoordinatePercent(value, vector) {
  const max = vector.reduce(
    (previous, current) => Math.max(previous, Math.abs(current)),
    1
  );
  return Math.abs(value) / max * 100;
}
export {
  compactValue,
  filterVectorRows,
  parseVectorInput,
  scalarLabel,
  vectorCoordinatePercent,
  vectorMagnitude,
  vectorSearchRequest
};
