function toasterHost(doc = document) {
  const modals = [...doc.querySelectorAll("dialog[open]")].filter((dialog) => {
    try {
      return dialog.matches(":modal");
    } catch {
      return false;
    }
  });
  return modals.at(-1) ?? doc.body;
}
function watchToasterHost(doc, onchange) {
  let current;
  const place = () => {
    const host = toasterHost(doc);
    if (host !== current) {
      current = host;
      onchange(host);
    }
  };
  place();
  const observer = new MutationObserver(place);
  observer.observe(doc.body, { subtree: true, attributes: true, attributeFilter: ["open"], childList: true });
  return () => observer.disconnect();
}
function watchToasterAttention(region, pause, resume) {
  const view = region.ownerDocument.defaultView;
  let hovered = false;
  let focused = false;
  let blurred = false;
  const sync = () => hovered || focused || blurred ? pause() : resume();
  const enter = () => {
    hovered = true;
    sync();
  };
  const leave = () => {
    hovered = false;
    sync();
  };
  const focusIn = () => {
    focused = true;
    sync();
  };
  const focusOut = (event) => {
    if (!region.contains(event.relatedTarget)) {
      focused = false;
      sync();
    }
  };
  const windowBlur = () => {
    blurred = true;
    sync();
  };
  const windowFocus = () => {
    blurred = false;
    sync();
  };
  region.addEventListener("pointerenter", enter);
  region.addEventListener("pointerleave", leave);
  region.addEventListener("focusin", focusIn);
  region.addEventListener("focusout", focusOut);
  view?.addEventListener("blur", windowBlur);
  view?.addEventListener("focus", windowFocus);
  return () => {
    region.removeEventListener("pointerenter", enter);
    region.removeEventListener("pointerleave", leave);
    region.removeEventListener("focusin", focusIn);
    region.removeEventListener("focusout", focusOut);
    view?.removeEventListener("blur", windowBlur);
    view?.removeEventListener("focus", windowFocus);
  };
}
function connectToaster(region, pause, resume) {
  const stopHost = watchToasterHost(region.ownerDocument, (host) => {
    if (region.parentElement !== host) host.append(region);
  });
  const stopAttention = watchToasterAttention(region, pause, resume);
  return () => {
    stopHost();
    stopAttention();
  };
}
export {
  connectToaster,
  toasterHost,
  watchToasterAttention,
  watchToasterHost
};
