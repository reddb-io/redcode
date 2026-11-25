import { collapseMiddle } from "./overflow.js";
function collapseBreadcrumbs(items, measure) {
  const current = items.findIndex((item) => item.current);
  return collapseMiddle(measure, current === -1 ? items.length - 1 : current);
}
function breadcrumbMenuItems(items) {
  return items.map(
    (item) => item.href !== void 0 ? { id: item.id, label: item.label, href: item.href } : { id: item.id, label: item.label, disabled: true }
  );
}
export {
  breadcrumbMenuItems,
  collapseBreadcrumbs
};
