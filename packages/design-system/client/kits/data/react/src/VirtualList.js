"use client";
import { jsx, jsxs } from "react/jsx-runtime";
import {
  Fragment,
  useLayoutEffect,
  useRef,
  useState
} from "react";
import { virtualRange, virtualKeys } from "../../src/virtual-list.js";
import { virtualList } from "../../src/virtual-list.variants.js";
import { useChartRhythm } from "./chart-state.js";
function VirtualList({
  label,
  items,
  rowKey,
  rowUnits = 2,
  visibleRows = 6,
  overscan = 2,
  children,
  emptyLabel = "No items.",
  className
}) {
  const root = useRef(null), probe = useRef(null), rhythm = useChartRhythm(probe), [top, setTop] = useState(0), [focused, setFocused] = useState(), keys = virtualKeys(items, rowKey, rowUnits, visibleRows), height = rhythm.row * rowUnits, range = virtualRange(
    items.length,
    height,
    height * visibleRows,
    top,
    overscan
  ), styles = virtualList(), rowHeight = `calc(var(--reddb-spatial-control-height-md) * ${rowUnits})`;
  const indices = Array.from(
    { length: range.end - range.start },
    (_, i) => range.start + i
  ), pinned = focused === void 0 ? -1 : keys.indexOf(focused);
  if (pinned >= 0 && !indices.includes(pinned)) indices.push(pinned);
  indices.sort((a, b) => a - b);
  useLayoutEffect(() => {
    if (root.current && Math.abs(root.current.scrollTop - range.top) > 1)
      root.current.scrollTop = range.top;
    if (focused !== void 0 && !keys.includes(focused)) {
      setFocused(void 0);
      queueMicrotask(() => root.current?.focus());
    }
  }, [range.top, focused, keys]);
  return /* @__PURE__ */ jsxs(
    "div",
    {
      ref: root,
      "data-virtual-list": true,
      className: styles.root({ class: className }),
      role: "region",
      "aria-label": label,
      tabIndex: 0,
      style: {
        height: `calc(var(--reddb-spatial-control-height-md) * ${rowUnits * visibleRows})`
      },
      onScroll: (event) => setTop(event.currentTarget.scrollTop),
      onFocus: (event) => {
        const row = event.target.closest(
          "[data-virtual-key]"
        );
        setFocused(row?.dataset.virtualKey);
      },
      onBlur: (event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          setFocused(void 0);
      },
      children: [
        /* @__PURE__ */ jsx("span", { ref: probe, "aria-hidden": "true", className: styles.probe() }),
        items.length ? /* @__PURE__ */ jsxs("ul", { className: styles.list(), "aria-label": label, children: [
          indices.map((index, position) => {
            const previous = position === 0 ? -1 : indices[position - 1];
            return /* @__PURE__ */ jsxs(Fragment, { children: [
              index > previous + 1 && /* @__PURE__ */ jsx(
                "li",
                {
                  role: "presentation",
                  "aria-hidden": "true",
                  style: {
                    height: `calc(${rowHeight} * ${index - previous - 1})`
                  }
                }
              ),
              /* @__PURE__ */ jsx(
                "li",
                {
                  className: styles.row(),
                  style: { height: rowHeight },
                  "aria-posinset": index + 1,
                  "aria-setsize": items.length,
                  "data-virtual-key": keys[index],
                  children: children(items[index], index)
                }
              )
            ] }, keys[index]);
          }),
          (indices.at(-1) ?? -1) < items.length - 1 && /* @__PURE__ */ jsx(
            "li",
            {
              role: "presentation",
              "aria-hidden": "true",
              style: {
                height: `calc(${rowHeight} * ${items.length - (indices.at(-1) ?? -1) - 1})`
              }
            }
          )
        ] }) : /* @__PURE__ */ jsx("p", { className: styles.empty(), children: emptyLabel })
      ]
    }
  );
}
var VirtualList_default = VirtualList;
export {
  VirtualList,
  VirtualList_default as default
};
