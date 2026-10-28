function openWorkspaceDocument(state, spec, createId, forceNew = false) {
  const previous = forceNew ? void 0 : state.items.find((item) => item.kind === spec.kind && item.key === spec.key);
  const document = { ...previous, ...spec, id: previous?.id ?? createId() };
  const items = previous ? state.items.map((item) => item === previous ? document : item) : [...state.items, document];
  return { state: { items, activeId: document.id }, document };
}
function focusWorkspaceDocument(state, id) {
  return state.items.some((item) => item.id === id) ? { ...state, activeId: id } : state;
}
function closeWorkspaceDocument(state, id, previousActiveId) {
  const index = state.items.findIndex((item) => item.id === id);
  if (index < 0) return state;
  const items = state.items.filter((item) => item.id !== id);
  if (state.activeId !== id) return { items, activeId: state.activeId };
  const previous = previousActiveId && items.some((item) => item.id === previousActiveId) ? previousActiveId : null;
  return { items, activeId: previous ?? items[Math.max(0, index - 1)]?.id ?? null };
}
function updateWorkspaceDocument(state, id, patch) {
  if (!state.items.some((item) => item.id === id)) return state;
  return { ...state, items: state.items.map((item) => item.id === id ? { ...item, ...patch, id: item.id } : item) };
}
export {
  closeWorkspaceDocument,
  focusWorkspaceDocument,
  openWorkspaceDocument,
  updateWorkspaceDocument
};
