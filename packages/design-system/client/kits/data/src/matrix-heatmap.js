import { finite, unique } from "./visualization.js";
function matrixData(rows, columns, data) {
  unique(rows, "Matrix rows");
  unique(columns, "Matrix columns");
  unique(data, "Matrix cells");
  const rowIds = new Set(rows.map((r) => r.id)), colIds = new Set(columns.map((c) => c.id)), pairs = /* @__PURE__ */ new Set();
  for (const cell of data) {
    if (!rowIds.has(cell.row) || !colIds.has(cell.column)) throw new Error("Matrix cell references an unknown axis");
    const pair = JSON.stringify([cell.row, cell.column]);
    if (pairs.has(pair)) throw new Error("Duplicate matrix coordinate");
    pairs.add(pair);
    if (cell.value !== null) finite(cell.value, cell.id);
  }
  return data;
}
export {
  matrixData
};
