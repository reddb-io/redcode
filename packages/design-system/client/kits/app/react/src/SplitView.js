"use client";
import { jsx, jsxs } from "react/jsx-runtime";
import { useImperativeHandle, useRef, useState } from "react";
import { useControllableValue } from "@reddb-io/design-system/base";
import { SPLIT_BOUNDS, clampFraction, fractionAt, fractionForKey, percentOf, separatorOrientation } from "../../src/primitives/split-view.behavior.js";
import { splitView } from "../../src/primitives/split-view.variants.js";
function SplitView(props) {
  const { orientation = "horizontal", fraction = 0.5, onFractionChange, min = SPLIT_BOUNDS.min, max = SPLIT_BOUNDS.max, label = "Resize panes", start, end, className, ref, onPointerMove, onPointerUp, onPointerCancel, ...rest } = props;
  const [current, setCurrent] = useControllableValue(props.fraction, fraction, onFractionChange), [dragging, setDragging] = useState(false), active = useRef(false), root = useRef(null), bounds = { min, max }, position = clampFraction(current, bounds), styles = splitView({ orientation, dragging });
  useImperativeHandle(ref, () => root.current, []);
  const release = () => {
    active.current = false;
    setDragging(false);
  }, commit = (next) => {
    if (next !== current) setCurrent(next);
  };
  return /* @__PURE__ */ jsxs("div", { ...rest, ref: root, className: styles.root({ class: className }), "data-orientation": orientation, onPointerMove: (event) => {
    onPointerMove?.(event);
    if (!active.current || !root.current) return;
    const box = root.current.getBoundingClientRect(), next = orientation === "horizontal" ? fractionAt(event.clientX - box.left, box.width, bounds) : fractionAt(event.clientY - box.top, box.height, bounds);
    if (next !== null) commit(next);
  }, onPointerUp: (event) => {
    onPointerUp?.(event);
    release();
  }, onPointerCancel: (event) => {
    onPointerCancel?.(event);
    release();
  }, children: [
    /* @__PURE__ */ jsx("div", { className: styles.pane(), style: { flexBasis: percentOf(position) }, children: start }),
    /* @__PURE__ */ jsx("div", { className: styles.divider(), "data-split-view-divider": true, role: "separator", tabIndex: 0, "aria-label": label, "aria-orientation": separatorOrientation(orientation), "aria-valuenow": Math.round(position * 100), "aria-valuemin": Math.round(clampFraction(min, bounds) * 100), "aria-valuemax": Math.round(clampFraction(max, bounds) * 100), onPointerDown: (event) => {
      active.current = true;
      setDragging(true);
      try {
        event.currentTarget.setPointerCapture?.(event.pointerId);
      } catch {
      }
    }, onLostPointerCapture: release, onKeyDown: (event) => {
      const next = fractionForKey(event.key, position, orientation, bounds);
      if (next !== null) {
        event.preventDefault();
        commit(next);
      }
    } }),
    /* @__PURE__ */ jsx("div", { className: styles.pane(), style: { flexBasis: percentOf(1 - position) }, children: end })
  ] });
}
export {
  SplitView
};
