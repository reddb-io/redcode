function navigationBadge(value) {
  return typeof value === "number" && value > 99 ? "99+" : String(value);
}
function navigationMarkerLabel(item, label) {
  const visible = item.badge === void 0 ? void 0 : navigationBadge(item.badge);
  const description = item.badgeLabel ?? `${item.badge} notifications`;
  const notification = visible === void 0 ? void 0 : description.includes(visible) ? description : `${visible} (${description})`;
  return [label, notification, item.status?.label].filter(Boolean).join(", ");
}
function navigationItems(items, currentId) {
  const matches = items.filter((item) => item.id === currentId);
  if (matches.length !== 1) {
    throw new Error(`currentId "${currentId}" must identify exactly one navigation item`);
  }
  return items.map((item) => ({ ...item, current: item.id === currentId }));
}
export {
  navigationBadge,
  navigationItems,
  navigationMarkerLabel
};
