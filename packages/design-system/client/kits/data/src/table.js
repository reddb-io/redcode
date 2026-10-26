const collator = new Intl.Collator(void 0, { numeric: true, sensitivity: "base" });
function defaultCompare(left, right) {
  if (Object.is(left, right)) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  if (typeof left === "number" && typeof right === "number") return left - right;
  if (left instanceof Date && right instanceof Date) return left.getTime() - right.getTime();
  return collator.compare(String(left), String(right));
}
function sortRows(rows, columns, sort) {
  if (!sort) return [...rows];
  const column = columns.find((candidate) => candidate.key === sort.key);
  if (!column) return [...rows];
  const sign = sort.direction === "descending" ? -1 : 1;
  return rows.map((row, index) => ({ row, index })).sort((left, right) => {
    const leftValue = left.row[column.key];
    const rightValue = right.row[column.key];
    if (leftValue == null || rightValue == null) {
      const compared2 = defaultCompare(leftValue, rightValue);
      return compared2 === 0 ? left.index - right.index : compared2;
    }
    const compared = column.compare ? column.compare(leftValue, rightValue, left.row, right.row) : defaultCompare(leftValue, rightValue);
    return compared === 0 ? left.index - right.index : compared * sign;
  }).map(({ row }) => row);
}
function filterRows(rows, columns, filters) {
  if (!filters) return [...rows];
  const active = columns.map((column) => ({ column, query: filters[column.key]?.trim() ?? "" })).filter(({ query }) => query.length > 0);
  if (active.length === 0) return [...rows];
  return rows.filter(
    (row) => active.every(({ column, query }) => {
      const value = row[column.key];
      if (column.filter) return column.filter(value, query, row);
      return String(value ?? "").toLocaleLowerCase().includes(query.toLocaleLowerCase());
    })
  );
}
function paginateRows(rows, options) {
  const pageSize = Math.max(1, Math.floor(options.pageSize) || 1);
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const page = Math.min(pageCount, Math.max(1, Math.floor(options.page) || 1));
  const start = (page - 1) * pageSize;
  const end = Math.min(rows.length, start + pageSize);
  return { rows: rows.slice(start, end), page, pageSize, pageCount, total: rows.length, start, end };
}
function virtualWindow(rows, options) {
  const rowHeight = Math.max(1, options.rowHeight);
  const viewportHeight = Math.max(0, options.viewportHeight);
  const scrollTop = Math.max(0, options.scrollTop);
  const overscan = Math.max(0, Math.floor(options.overscan ?? 2));
  const visibleStart = Math.floor(scrollTop / rowHeight);
  const visibleEnd = Math.ceil((scrollTop + viewportHeight) / rowHeight);
  const start = Math.min(rows.length, Math.max(0, visibleStart - overscan));
  const end = Math.min(rows.length, Math.max(start, visibleEnd + overscan));
  return {
    items: rows.slice(start, end),
    start,
    end,
    offsetTop: start * rowHeight,
    offsetBottom: (rows.length - end) * rowHeight,
    totalHeight: rows.length * rowHeight
  };
}
function stageChange(changes, next) {
  const index = changes.findIndex(
    (change2) => change2.rowKey === next.rowKey && change2.columnKey === next.columnKey
  );
  const previous = index >= 0 ? changes[index].previous : next.previous;
  const withoutCell = changes.filter((_, candidate) => candidate !== index);
  if (Object.is(previous, next.value)) return withoutCell;
  const change = { ...next, previous };
  return index < 0 ? [...withoutCell, change] : [...withoutCell.slice(0, index), change, ...withoutCell.slice(index)];
}
function valueWithChanges(value, changes, rowKey, columnKey) {
  const change = changes.find(
    (candidate) => candidate.rowKey === rowKey && candidate.columnKey === columnKey
  );
  return change ? change.value : value;
}
function applyChanges(rows, changes, rowKey) {
  if (changes.length === 0) return [...rows];
  return rows.map((row, index) => {
    const key = rowKey(row, index);
    const rowChanges = changes.filter((change) => change.rowKey === key);
    if (rowChanges.length === 0) return row;
    const copy = { ...row };
    for (const change of rowChanges) copy[change.columnKey] = change.value;
    return copy;
  });
}
export {
  applyChanges,
  filterRows,
  paginateRows,
  sortRows,
  stageChange,
  valueWithChanges,
  virtualWindow
};
