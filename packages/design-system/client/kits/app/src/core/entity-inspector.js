function inspectedEntity(items, selected) {
  const ids = /* @__PURE__ */ new Set();
  for (const item of items) {
    if (!item.id || ids.has(item.id))
      throw new Error("EntityInspector: ids must be non-empty and unique.");
    ids.add(item.id);
  }
  const index = items.findIndex((item) => item.id === selected);
  return {
    entity: items[index],
    index,
    previous: items[index - 1]?.id,
    next: index < 0 ? void 0 : items[index + 1]?.id
  };
}
export {
  inspectedEntity
};
