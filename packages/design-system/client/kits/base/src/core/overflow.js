const TEXT_OVERFLOWS = ["wrap", "truncate", "anywhere"];
const ROW_OVERFLOWS = ["wrap", "scroll", "collapse"];
const TRUNCATE_LINES = [1, 2, 3];
function fitCount(itemWidths, available, moreWidth, gap = 0) {
  if (!Number.isFinite(available) || available <= 0) return 0;
  const total = itemWidths.reduce((sum, width, index) => sum + width + (index > 0 ? gap : 0), 0);
  if (total <= available) return itemWidths.length;
  let used = moreWidth;
  let count = 0;
  for (const width of itemWidths) {
    const next = used + gap + width;
    if (next > available) break;
    used = next;
    count += 1;
  }
  return count;
}
const OVERFLOW_ITEM_ATTRIBUTE = "data-overflow-item";
const OVERFLOW_MORE_ATTRIBUTE = "data-overflow-more";
function collapseTail({ itemWidths, available, moreWidth, gap }) {
  const fit = fitCount(itemWidths, available, moreWidth, gap);
  return itemWidths.map((_, index) => index).slice(fit);
}
function collapseMiddle({ itemWidths, available, moreWidth, gap }, pinned = itemWidths.length - 1) {
  const count = itemWidths.length;
  if (count <= 2) return [];
  const tail = Math.min(Math.max(pinned, 1), count - 1);
  const fixed = itemWidths[0] + gap + itemWidths.slice(tail).reduce((sum, width) => sum + width + gap, 0);
  const middle = itemWidths.slice(1, tail).reverse();
  const keep = fitCount(middle, available - fixed, moreWidth, gap);
  if (keep >= middle.length) return [];
  return Array.from({ length: middle.length - keep }, (_, index) => index + 1);
}
function rowEntries(items, hidden) {
  if (hidden.length === 0) return items.map((item) => ({ kind: "item", item }));
  const set = new Set(hidden);
  const entries = [];
  const more = [];
  for (const item of items) {
    if (!set.has(item.id)) {
      entries.push({ kind: "item", item });
      continue;
    }
    if (more.length === 0) entries.push({ kind: "more", items: more });
    more.push(item);
  }
  return entries;
}
const pixels = (value) => Number.parseFloat(value) || 0;
function observeRowCollapse(root, options) {
  const widths = /* @__PURE__ */ new Map();
  let moreWidth = 0;
  let reported = "";
  const update = () => {
    if (root.clientWidth <= 0) return;
    for (const element of root.querySelectorAll(`[${OVERFLOW_ITEM_ATTRIBUTE}]`)) {
      const id = element.getAttribute(OVERFLOW_ITEM_ATTRIBUTE);
      if (id !== null) widths.set(id, Math.ceil(element.getBoundingClientRect().width));
    }
    const more = root.querySelector(`[${OVERFLOW_MORE_ATTRIBUTE}]`);
    if (more !== null) moreWidth = Math.ceil(more.getBoundingClientRect().width);
    const style = getComputedStyle(root);
    const available = Math.floor(root.clientWidth - pixels(style.paddingInlineStart) - pixels(style.paddingInlineEnd));
    const gap = pixels(style.columnGap);
    const ids = options.ids();
    const itemWidths = ids.map((id) => widths.get(id) ?? 0);
    const estimate = moreWidth > 0 ? moreWidth : Math.max(0, ...itemWidths);
    const hidden = options.plan({ itemWidths, available, moreWidth: estimate, gap }).map((index) => ids[index]);
    const key = hidden.join("\0");
    if (key === reported) return;
    reported = key;
    options.onchange(hidden);
  };
  update();
  if (typeof ResizeObserver === "undefined") {
    window.addEventListener("resize", update);
    return { update, disconnect: () => window.removeEventListener("resize", update) };
  }
  const observer = new ResizeObserver(() => update());
  observer.observe(root);
  return { update, disconnect: () => observer.disconnect() };
}
export {
  OVERFLOW_ITEM_ATTRIBUTE,
  OVERFLOW_MORE_ATTRIBUTE,
  ROW_OVERFLOWS,
  TEXT_OVERFLOWS,
  TRUNCATE_LINES,
  collapseMiddle,
  collapseTail,
  fitCount,
  observeRowCollapse,
  rowEntries
};
