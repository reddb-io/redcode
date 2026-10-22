const APPEARANCE_AXES = ["theme", "color-scheme", "density"];
function appearanceAttribute(axis) {
  return `data-${axis}`;
}
function appearanceStorageKey(axis) {
  return `reddb:appearance:${axis}`;
}
function applyAppearance(root, axis, value) {
  root.setAttribute(appearanceAttribute(axis), value);
}
export {
  APPEARANCE_AXES,
  appearanceAttribute,
  appearanceStorageKey,
  applyAppearance
};
