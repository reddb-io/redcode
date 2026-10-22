function focusSkipTarget(event, href, document) {
  if (event.defaultPrevented || !href.startsWith("#")) return;
  let id;
  try {
    id = decodeURIComponent(href.slice(1));
  } catch {
    return;
  }
  document.getElementById(id)?.focus();
}
export {
  focusSkipTarget
};
