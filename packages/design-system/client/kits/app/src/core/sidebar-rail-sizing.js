function sidebarRailSizing(sizing, labelled = false) {
  for (const prop of ["itemSize", "iconSize", "itemGap", "railWidth", "railPadding", "labelSize"]) {
    const value = sizing[prop], zero = prop === "itemGap" || prop === "railPadding";
    if (value !== void 0 && (!Number.isFinite(value) || value < 0 || !zero && value === 0)) {
      throw new Error(`SidebarRail ${prop} must be a finite ${zero ? "non-negative" : "positive"} CSS-pixel value`);
    }
  }
  const px = (value) => `${value}px`;
  const size = sizing.itemSize === void 0 ? "var(--reddb-spatial-control-height-md)" : px(sizing.itemSize);
  const hit = `max(${size},var(--reddb-spatial-target-min))`;
  const padding = sizing.railPadding === void 0 ? "var(--reddb-spatial-inset-sm)" : px(sizing.railPadding);
  const root = {}, item = {}, face = {}, glyph = {}, label = {}, list = {};
  if (sizing.itemSize !== void 0 || sizing.railWidth !== void 0 || sizing.railPadding !== void 0) {
    const natural = `calc(${labelled ? `max(6.65em,${hit} * 2)` : hit} + 2 * ${padding})`;
    root.minWidth = `calc(${hit} + 2 * ${padding} + 1px)`;
    root.width = `max(${sizing.railWidth === void 0 ? natural : px(sizing.railWidth)},calc(${hit} + 2 * ${padding} + 1px))`;
  }
  if (sizing.railPadding !== void 0) root.padding = px(sizing.railPadding);
  if (sizing.itemSize !== void 0) {
    item.minHeight = hit;
    if (labelled) {
      face.width = hit;
      face.height = hit;
    } else {
      item.width = hit;
      item.height = hit;
    }
  }
  if (sizing.iconSize !== void 0) glyph.width = glyph.height = `min(${px(sizing.iconSize)},calc(${hit} - 2px))`;
  if (sizing.labelSize !== void 0) label.fontSize = px(sizing.labelSize);
  if (sizing.itemGap !== void 0) list.gap = px(sizing.itemGap);
  return { root, item, face, glyph, label, list };
}
function sidebarRailStyle(style) {
  return Object.entries(style).map(([name, value]) => `${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}:${value}`).join(";") || void 0;
}
export {
  sidebarRailSizing,
  sidebarRailStyle
};
