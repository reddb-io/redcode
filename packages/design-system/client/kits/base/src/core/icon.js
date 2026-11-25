const ICON_SIZES = ["sm", "md", "lg", "text"];
const ICON_COLORS = ["current", "foreground", "ink-muted", "primary", "on-primary", "feedback-danger-foreground", "feedback-success-foreground", "feedback-warning-foreground", "feedback-info-foreground"];
function iconColor(role) {
  return role === "current" ? "currentColor" : `var(--reddb-color-${role})`;
}
function iconDimension(size) {
  return size === "text" ? "var(--reddb-glyph-size, 1em)" : `var(--reddb-spatial-icon-size-${size})`;
}
export {
  ICON_COLORS,
  ICON_SIZES,
  iconColor,
  iconDimension
};
