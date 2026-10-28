function workspaceTabs(items) {
  const ids = /* @__PURE__ */ new Set();
  for (const item of items) {
    if (!item.id.trim() || ids.has(item.id))
      throw new Error("WorkspaceTabs requires unique non-empty ids.");
    ids.add(item.id);
  }
  return items;
}
function workspaceSelection(items, selected) {
  return items.find((item) => item.id === selected && !item.disabled)?.id ?? items.find((item) => !item.disabled)?.id ?? "";
}
function mountWorkspaceFocus(root) {
  let focused = null;
  const remember = (event) => {
    focused = event.target.closest(
      "[data-workspace-item]"
    )?.dataset.workspaceItem ?? null;
  };
  root.addEventListener("focusin", remember);
  return {
    sync(items, selected) {
      if (!focused || items.some((item) => item.id === focused && !item.disabled))
        return;
      focused = null;
      const active = root.getRootNode().activeElement;
      if (!active || active === root.ownerDocument.body || root.contains(active)) {
        [...root.querySelectorAll('[role="tab"]')].find((item) => item.dataset.workspaceTab === selected)?.focus();
      }
    },
    destroy() {
      root.removeEventListener("focusin", remember);
    }
  };
}
export {
  mountWorkspaceFocus,
  workspaceSelection,
  workspaceTabs
};
