function toolbarOverflow(orientation, overflow) {
  return orientation === "horizontal" ? overflow : "wrap";
}
function toolbarMenuItems(items) {
  return items.map((item) => ({
    id: item.id,
    label: item.label,
    ...item.href !== void 0 && !item.disabled ? { href: item.href } : {},
    ...item.disabled ? { disabled: true } : {},
    ...item.onselect !== void 0 ? { onselect: item.onselect } : {}
  }));
}
export {
  toolbarMenuItems,
  toolbarOverflow
};
