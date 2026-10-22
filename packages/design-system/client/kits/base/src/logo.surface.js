import { LOGO_SURFACES } from "./logo.marks.js";
const COLOR_SCHEME_ATTRIBUTE = "data-color-scheme";
function surfaceOfColorScheme(scheme) {
  return scheme === "dark" ? "dark" : "light";
}
function activeSurface(doc = globalThis.document) {
  if (!doc) return "light";
  return surfaceOfColorScheme(doc.documentElement.getAttribute(COLOR_SCHEME_ATTRIBUTE));
}
function observeActiveSurface(report, doc = globalThis.document) {
  report(activeSurface(doc));
  const Observer = doc?.defaultView?.MutationObserver;
  if (!doc || !Observer) return () => {
  };
  const observer = new Observer(() => report(activeSurface(doc)));
  observer.observe(doc.documentElement, {
    attributes: true,
    attributeFilter: [COLOR_SCHEME_ATTRIBUTE]
  });
  return () => observer.disconnect();
}
function isLogoSurface(value) {
  return typeof value === "string" && LOGO_SURFACES.includes(value);
}
export {
  COLOR_SCHEME_ATTRIBUTE,
  activeSurface,
  isLogoSurface,
  observeActiveSurface,
  surfaceOfColorScheme
};
