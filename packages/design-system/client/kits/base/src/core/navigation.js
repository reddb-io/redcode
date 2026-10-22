function ownsSameOrigin(href, anchor) {
  if (href === "" || href.startsWith("#")) return false;
  const url = new URL(anchor.href, anchor.ownerDocument.baseURI);
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  return url.origin === new URL(anchor.ownerDocument.baseURI).origin;
}
function routableAnchor(event, scope, owns = ownsSameOrigin) {
  if (event.defaultPrevented || event.button !== 0) return null;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  const target = event.target;
  if (!(target instanceof Element)) return null;
  const anchor = target.closest("a[href]");
  if (!anchor || !scope.contains(anchor)) return null;
  if (anchor.hasAttribute("download") || anchor.hasAttribute("data-native-navigation")) return null;
  const targetContext = anchor.getAttribute("target");
  if (targetContext !== null && targetContext !== "" && targetContext !== "_self") return null;
  const href = anchor.getAttribute("href") ?? "";
  return owns(href, anchor) ? anchor : null;
}
export {
  ownsSameOrigin,
  routableAnchor
};
