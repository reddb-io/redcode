function a11yDevelopment() {
  return import.meta.env?.DEV ?? globalThis.process?.env?.NODE_ENV === "development";
}
const warned = /* @__PURE__ */ new Set();
function warnA11y(component, problem, fix) {
  if (!a11yDevelopment()) return;
  const key = `${component}\0${problem}`;
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[reddb ${component}] ${problem}. ${fix}`);
}
function nonEmpty(value) {
  return typeof value === "string" && value.trim() !== "";
}
function namedContent(node) {
  if (node.nodeType === 3) return nonEmpty(node.textContent);
  if (node.nodeType !== 1) return false;
  const element = node;
  if (element.getAttribute("aria-hidden") === "true") return false;
  if (nonEmpty(element.getAttribute("aria-label"))) return true;
  if (element.tagName === "IMG" && nonEmpty(element.getAttribute("alt"))) return true;
  if (element.tagName.toLowerCase() === "title") return nonEmpty(element.textContent);
  for (const child of element.childNodes) if (namedContent(child)) return true;
  return false;
}
function hasAccessibleName(element, { fromContent = false } = {}) {
  if (nonEmpty(element.getAttribute("aria-label"))) return true;
  const labelledBy = element.getAttribute("aria-labelledby");
  if (nonEmpty(labelledBy)) {
    const root = element.getRootNode();
    for (const id of labelledBy.trim().split(/\s+/)) {
      const target = root.getElementById?.(id) ?? element.ownerDocument.getElementById(id);
      if (target && nonEmpty(target.textContent)) return true;
    }
  }
  const labels = element.labels;
  if (labels) {
    for (const label of labels) if (nonEmpty(label.textContent)) return true;
  }
  if (nonEmpty(element.getAttribute("title"))) return true;
  return fromContent && namedContent(element);
}
const FIELD_NAME_FIX = "Wrap it in a Field with a `label`, or pass `aria-label` or `aria-labelledby`, or point a native <label for> at its id";
function checkFieldName(component, element) {
  if (!a11yDevelopment() || !element) return;
  if (hasAccessibleName(element)) return;
  warnA11y(component, "renders a form control with no accessible name", `${FIELD_NAME_FIX}.`);
}
function contentWords(node) {
  if (node.nodeType === 3) return node.textContent ?? "";
  if (node.nodeType !== 1) return "";
  const element = node;
  if (element.matches("[hidden], .hidden, .sr-only, svg, script, style")) return "";
  return [...element.childNodes].map(contentWords).join(" ");
}
function checkButtonName(component, element) {
  if (!a11yDevelopment() || !element) return;
  if (!hasAccessibleName(element, { fromContent: true })) {
    warnA11y(component, "renders with no text and no `aria-label`, so it has no accessible name", "Pass `aria-label` (or `aria-labelledby`) to an icon-only Button.");
    return;
  }
  const normalize = (text) => text.replace(/\s+/g, " ").trim().toLocaleLowerCase();
  const visible = normalize(contentWords(element));
  if (!/[\p{L}\p{N}]/u.test(visible)) return;
  const ids = element.getAttribute("aria-labelledby")?.trim().split(/\s+/).filter(Boolean) ?? [];
  const root = element.getRootNode();
  const referenced = ids.map((id) => (root.getElementById?.(id) ?? element.ownerDocument.getElementById(id))?.textContent ?? "").join(" ");
  const name = normalize(referenced || element.getAttribute("aria-label") || visible);
  if (!name.includes(visible)) {
    warnA11y(component, "visible text is missing from its accessible name", "Keep the visible action in the name; use `aria-describedby` for row context instead of replacing the action with `aria-labelledby`.");
  }
}
export {
  FIELD_NAME_FIX,
  checkButtonName,
  checkFieldName,
  hasAccessibleName,
  warnA11y
};
