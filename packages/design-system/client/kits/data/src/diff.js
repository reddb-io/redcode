function formatDiffValue(value) {
  if (value === void 0) return "undefined";
  if (typeof value === "string") return value;
  if (typeof value === "bigint") return `${value}n`;
  const serialized = JSON.stringify(value);
  return serialized === void 0 ? String(value) : serialized;
}
const MISSING = /* @__PURE__ */ Symbol("missing");
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function leafValues(value, parent = "") {
  const leaves = /* @__PURE__ */ new Map();
  const visit = (current, path) => {
    if (Array.isArray(current)) {
      if (current.length === 0) leaves.set(path || "$", current);
      else current.forEach((item, index) => visit(item, path ? `${path}.${index}` : `${index}`));
      return;
    }
    if (isRecord(current)) {
      const entries = Object.entries(current);
      if (entries.length === 0) leaves.set(path || "$", current);
      else for (const [key, item] of entries) visit(item, path ? `${path}.${key}` : key);
      return;
    }
    leaves.set(path || "$", current);
  };
  visit(value, parent);
  return leaves;
}
function summarize(entries) {
  const summary = { added: 0, removed: 0, changed: 0, unchanged: 0 };
  for (const entry of entries) summary[entry.kind] += 1;
  return summary;
}
function diffFields(before, after) {
  const beforeFields = leafValues(before);
  const afterFields = leafValues(after);
  const paths = [...beforeFields.keys(), ...afterFields.keys()].filter(
    (path, index, all) => all.indexOf(path) === index
  );
  const entries = paths.map((path) => {
    const oldValue = beforeFields.has(path) ? beforeFields.get(path) : MISSING;
    const newValue = afterFields.has(path) ? afterFields.get(path) : MISSING;
    if (oldValue === MISSING) return { path, kind: "added", after: newValue };
    if (newValue === MISSING) return { path, kind: "removed", before: oldValue };
    return Object.is(oldValue, newValue) ? { path, kind: "unchanged", before: oldValue, after: newValue } : { path, kind: "changed", before: oldValue, after: newValue };
  });
  return { entries, summary: summarize(entries) };
}
function lineOperations(before, after) {
  const lengths = Array.from(
    { length: before.length + 1 },
    () => Array(after.length + 1).fill(0)
  );
  for (let left2 = before.length - 1; left2 >= 0; left2 -= 1) {
    for (let right2 = after.length - 1; right2 >= 0; right2 -= 1) {
      lengths[left2][right2] = before[left2] === after[right2] ? lengths[left2 + 1][right2 + 1] + 1 : Math.max(lengths[left2 + 1][right2], lengths[left2][right2 + 1]);
    }
  }
  const operations = [];
  let left = 0;
  let right = 0;
  while (left < before.length || right < after.length) {
    if (left < before.length && right < after.length && before[left] === after[right]) {
      operations.push({ kind: "unchanged", value: before[left] });
      left += 1;
      right += 1;
    } else if (right < after.length && (left === before.length || lengths[left][right + 1] >= lengths[left + 1][right])) {
      operations.push({ kind: "added", value: after[right] });
      right += 1;
    } else {
      operations.push({ kind: "removed", value: before[left] });
      left += 1;
    }
  }
  return operations;
}
function diffLines(before, after) {
  const operations = lineOperations(before.split("\n"), after.split("\n"));
  const entries = [];
  for (let index = 0; index < operations.length; ) {
    const operation = operations[index];
    if (operation.kind === "unchanged") {
      entries.push({ path: "", kind: "unchanged", before: operation.value, after: operation.value });
      index += 1;
      continue;
    }
    const block = [];
    while (index < operations.length && operations[index].kind !== "unchanged") {
      block.push(operations[index]);
      index += 1;
    }
    const removed = block.filter((item) => item.kind === "removed");
    const added = block.filter((item) => item.kind === "added");
    const pairs = Math.min(removed.length, added.length);
    for (let pair = 0; pair < pairs; pair += 1) {
      entries.push({
        path: "",
        kind: "changed",
        before: removed[pair].value,
        after: added[pair].value
      });
    }
    for (const item of removed.slice(pairs)) {
      entries.push({ path: "", kind: "removed", before: item.value });
    }
    for (const item of added.slice(pairs)) {
      entries.push({ path: "", kind: "added", after: item.value });
    }
  }
  entries.forEach((entry, index) => entry.path = `${index + 1}`);
  return { entries, summary: summarize(entries) };
}
export {
  diffFields,
  diffLines,
  formatDiffValue
};
