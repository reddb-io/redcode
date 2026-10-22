const ICON_SIZES = ["sm", "md", "lg"];
const ICON_COLORS = ["current", "foreground", "ink-muted", "primary", "on-primary", "feedback-danger-foreground", "feedback-success-foreground", "feedback-warning-foreground", "feedback-info-foreground"];
function iconColor(color) {
  const role = color === "muted" ? "ink-muted" : color;
  return role === "current" ? "currentColor" : `var(--reddb-color-${role})`;
}
function iconDimension(size) {
  return `var(--reddb-spatial-icon-size-${size})`;
}
export {
  ICON_COLORS,
  ICON_SIZES,
  iconColor,
  iconDimension
};
