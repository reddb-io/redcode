const collator = new Intl.Collator(void 0, { numeric: true, sensitivity: "base" });
function materialize(nodes) {
  return [...nodes].sort((left, right) => collator.compare(left.label, right.label)).map((node) => {
    const result = {
      id: node.id,
      label: node.label,
      children: materialize(node.children.values())
    };
    if ("value" in node) result.value = node.value;
    return result;
  });
}
function buildPathTree(paths, options = {}) {
  const separator = options.separator ?? "/";
  if (separator.length === 0) throw new RangeError("The path separator cannot be empty.");
  const roots = /* @__PURE__ */ new Map();
  for (const [path, value] of Object.entries(paths)) {
    const segments = path.split(separator).filter((segment) => segment.length > 0);
    let siblings = roots;
    const ancestors = [];
    for (const [index, label] of segments.entries()) {
      ancestors.push(label);
      let node = siblings.get(label);
      if (!node) {
        node = { id: ancestors.join(separator), label, children: /* @__PURE__ */ new Map() };
        siblings.set(label, node);
      }
      if (index === segments.length - 1) node.value = value;
      siblings = node.children;
    }
  }
  return materialize(roots.values());
}
function flattenTree(siblings, open, level = 1, parentId = null) {
  const result = [];
  for (const [index, node] of siblings.entries()) {
    result.push({ node, level, parentId, position: index + 1, setSize: siblings.length });
    if (node.children.length && open.has(node.id)) result.push(...flattenTree(node.children, open, level + 1, node.id));
  }
  return result;
}
function findTreeNode(siblings, id) {
  for (const node of siblings) {
    if (node.id === id) return node;
    const child = findTreeNode(node.children, id);
    if (child) return child;
  }
  return void 0;
}
function treeContains(node, id) {
  return node.children.some((child) => child.id === id || treeContains(child, id));
}
function treeDropPosition(node, offset, height) {
  return node.children.length && offset >= height / 3 && offset <= height * 2 / 3 ? "inside" : offset < height / 2 ? "before" : "after";
}
export {
  buildPathTree,
  findTreeNode,
  flattenTree,
  treeContains,
  treeDropPosition
};
