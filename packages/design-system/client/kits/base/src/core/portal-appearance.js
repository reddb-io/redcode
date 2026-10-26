function modalPortalContainer(source) {
  return source.closest("dialog[open]") ?? void 0;
}
function observePortalAppearance(source, changed) {
  const keys = ["data-theme", "data-color-scheme", "data-density"];
  const read = () => changed({
    attributes: Object.fromEntries(keys.flatMap((key) => {
      const value = source.closest(`[${key}]`)?.getAttribute(key);
      return value == null ? [] : [[key, value]];
    })),
    container: modalPortalContainer(source)
  });
  read();
  const observer = new MutationObserver(read);
  for (let node = source; node; node = node.parentElement) observer.observe(node, { attributes: true, attributeFilter: [...keys, "open"] });
  return () => observer.disconnect();
}
export {
  modalPortalContainer,
  observePortalAppearance
};
