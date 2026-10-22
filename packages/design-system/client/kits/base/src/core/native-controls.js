function nextPressed(pressed, allowUnpress) {
  return pressed && !allowUnpress ? pressed : !pressed;
}
function ratingStops(max) {
  const count = Number.isFinite(max) ? Math.max(1, Math.floor(max)) : 5;
  return Array.from({ length: count }, (_, index) => index + 1);
}
function fileNames(files) {
  return Array.from(files ?? [], (file) => file.name);
}
function afterFormReset(form, reconcile) {
  const pending = /* @__PURE__ */ new Set();
  const reset = (event) => {
    const timer = setTimeout(() => {
      pending.delete(timer);
      if (!event.defaultPrevented) reconcile();
    }, 0);
    pending.add(timer);
  };
  form?.addEventListener("reset", reset);
  return () => {
    form?.removeEventListener("reset", reset);
    pending.forEach((timer) => clearTimeout(timer));
  };
}
function associatedForm(control, formId) {
  if (!control) return null;
  if (formId == null) return control.form;
  const owner = control.ownerDocument.getElementById(formId);
  return owner?.tagName === "FORM" ? owner : null;
}
export {
  afterFormReset,
  associatedForm,
  fileNames,
  nextPressed,
  ratingStops
};
