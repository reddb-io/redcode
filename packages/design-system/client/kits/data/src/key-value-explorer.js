function buildTree(entries) {
  const root = {
    name: "",
    fullKey: null,
    value: void 0,
    children: []
  };
  for (const entry of entries) {
    const segments = entry.key.split("/").filter((s) => s.length > 0);
    if (segments.length === 0) continue;
    let cursor = root;
    segments.forEach((seg, i) => {
      let child = cursor.children.find((c) => c.name === seg);
      if (!child) {
        child = { name: seg, fullKey: null, value: void 0, children: [] };
        const idx = cursor.children.findIndex((c) => c.name > seg);
        if (idx < 0) cursor.children.push(child);
        else cursor.children.splice(idx, 0, child);
      }
      if (i === segments.length - 1) {
        child.fullKey = entry.key;
        child.value = entry.value;
      }
      cursor = child;
    });
  }
  return root;
}
function formatValue(v) {
  if (v === null || v === void 0) return "null";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
function filterKvEntries(entries, prefix) {
  const term = prefix.trim();
  return entries.filter((entry) => entry.key.startsWith(term));
}
function materializeKvJson(entries, prefix) {
  const branch = () => ({ children: /* @__PURE__ */ new Map(), present: false });
  const root = branch();
  for (const entry of entries) {
    if (!entry.key.startsWith(prefix)) continue;
    const segments = entry.key.slice(prefix.length).split("/").filter(Boolean);
    let cursor = root;
    for (const segment of segments) {
      let next = cursor.children.get(segment);
      if (!next) {
        next = branch();
        cursor.children.set(segment, next);
      }
      cursor = next;
    }
    cursor.present = true;
    cursor.value = entry.value;
  }
  const emit = (node, isRoot = false) => {
    if (!isRoot && !node.children.size && node.present) return node.value;
    const result = /* @__PURE__ */ Object.create(null);
    for (const [key, child] of node.children) result[key] = emit(child);
    if (node.present) {
      let key = "$value";
      while (Object.hasOwn(result, key)) key = "$" + key;
      result[key] = node.value;
    }
    return result;
  };
  return emit(root, true);
}
function flattenUnderPrefix(entries, prefix) {
  const result = /* @__PURE__ */ Object.create(null);
  for (const entry of entries)
    if (entry.key.startsWith(prefix))
      result[entry.key.slice(prefix.length).replace(/^\/+/, "") || "$value"] = entry.value;
  return result;
}
function kvTreeNodes(entries) {
  const convert = (node, path) => {
    const id = path + "/" + node.name;
    return {
      id,
      label: node.name,
      children: node.children.map((child) => convert(child, id))
    };
  };
  return buildTree([...entries]).children.map((node) => convert(node, ""));
}
function kvExpandedIds(nodes) {
  return nodes.flatMap((node) => [node.id, ...kvExpandedIds(node.children)]);
}
function kvEntryAt(entries, id) {
  return [...entries].reverse().find(
    (entry) => "/" + entry.key.split("/").filter(Boolean).join("/") === id
  );
}
function renderKvSnapshot(entries) {
  const tree = buildTree(entries);
  const lines = [];
  lines.push('<section class="kv">');
  lines.push(`<header class="summary">${entries.length} keys</header>`);
  lines.push('<ul class="tree">');
  for (const child of tree.children) {
    walk(child, 0, lines);
  }
  lines.push("</ul>");
  lines.push("</section>");
  return lines.join("");
}
function walk(node, depth, out) {
  const hasValue = node.fullKey !== null;
  const cls = ["node"];
  if (hasValue) cls.push("leaf");
  out.push(`<li class="${cls.join(" ")}" data-depth="${depth}">`);
  out.push(`<span class="seg">${escapeHtml(node.name)}</span>`);
  if (hasValue) {
    out.push(
      `<span class="val">${escapeHtml(truncate(formatValue(node.value)))}</span>`
    );
  }
  if (node.children.length > 0) {
    out.push('<ul class="children">');
    for (const child of node.children) walk(child, depth + 1, out);
    out.push("</ul>");
  }
  out.push("</li>");
}
function truncate(s, max = 80) {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "\u2026";
}
function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
export {
  buildTree,
  filterKvEntries,
  flattenUnderPrefix,
  formatValue,
  kvEntryAt,
  kvExpandedIds,
  kvTreeNodes,
  materializeKvJson,
  renderKvSnapshot
};
