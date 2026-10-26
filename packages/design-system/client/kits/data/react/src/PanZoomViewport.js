"use client";
import { jsx, jsxs } from "react/jsx-runtime";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState
} from "react";
import { Button, useControllableValue } from "@reddb-io/design-system/base";
import {
  checkView,
  fitView,
  zoomView
} from "../../src/pan-zoom.js";
import { panZoom } from "../../src/pan-zoom.variants.js";
function PanZoomViewport(props) {
  const {
    label,
    contentWidth,
    contentHeight,
    view,
    onViewChange,
    onnavigate,
    overlay,
    minScale = 0.05,
    maxScale = 8,
    size = "md",
    aspectRatio,
    showControls = true,
    controls,
    zoomInLabel = "Zoom in",
    zoomOutLabel = "Zoom out",
    fitLabel = "Fit",
    instructions = "Drag to pan. Use arrow keys to move, plus or minus to zoom, and Home to fit. Control or Command plus wheel zooms around the pointer.",
    children,
    className
  } = props;
  const [active, setActive] = useControllableValue(
    view,
    view,
    (next) => {
      if (next) onViewChange?.(next);
    }
  ), viewport = useRef(null), [box, setBox] = useState({ width: 0, height: 0 }), initial = useRef(view), interacted = useRef(false), pointers = useRef(
    /* @__PURE__ */ new Map()
  ), id = useId(), styles = panZoom(), rows = { sm: 6, md: 10, lg: 14 };
  fitView(
    { width: contentWidth, height: contentHeight },
    { width: 1, height: 1 },
    minScale,
    maxScale
  );
  if (aspectRatio !== void 0 && (!Number.isFinite(aspectRatio) || aspectRatio <= 0))
    throw new Error("PanZoomViewport: aspectRatio must be finite and positive");
  const current = checkView(
    active ?? { x: 0, y: 0, scale: 1 },
    minScale,
    maxScale
  ), live = useRef(current);
  live.current = current;
  const update = (next, manual = true) => {
    if (manual) onnavigate?.();
    const valid = checkView(next, minScale, maxScale);
    if (props.view === void 0) live.current = valid;
    setActive(valid);
  };
  const reset = (manual = false) => {
    if (box.width && box.height)
      update(
        fitView(
          { width: contentWidth, height: contentHeight },
          box,
          minScale,
          maxScale
        ),
        manual
      );
  };
  const zoom = (factor, anchor = { x: box.width / 2, y: box.height / 2 }) => {
    interacted.current = true;
    update(zoomView(live.current, factor, anchor, minScale, maxScale));
  };
  const latest = useRef({ zoom, reset });
  latest.current = { zoom, reset };
  useLayoutEffect(() => {
    if (!viewport.current) return;
    const node = viewport.current, measure = () => setBox(
      (previous) => previous.width === node.clientWidth && previous.height === node.clientHeight ? previous : { width: node.clientWidth, height: node.clientHeight }
    );
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    if (box.width && box.height && !interacted.current && !initial.current)
      latest.current.reset();
  }, [box.width, box.height]);
  const point = (event) => {
    const rect = viewport.current.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const interactive = (target) => target instanceof Element && target.closest(
    "button,a,input,textarea,select,[contenteditable=true],[role=button],[role=link]"
  );
  useEffect(() => {
    const node = viewport.current;
    if (!node) return;
    const wheel = (event) => {
      if (!event.ctrlKey && !event.metaKey || interactive(event.target))
        return;
      event.preventDefault();
      latest.current.zoom(
        Math.exp(-Math.max(-100, Math.min(100, event.deltaY)) * 0.01),
        point(event)
      );
    };
    node.addEventListener("wheel", wheel, { passive: false });
    return () => {
      node.removeEventListener("wheel", wheel);
      pointers.current.clear();
    };
  }, []);
  function down(event) {
    if (event.button !== 0 || interactive(event.target)) return;
    interacted.current = true;
    event.preventDefault();
    viewport.current?.focus({ preventScroll: true });
    pointers.current.set(event.pointerId, point(event));
    viewport.current?.setPointerCapture?.(event.pointerId);
  }
  function move(event) {
    const previous = pointers.current.get(event.pointerId);
    if (!previous) return;
    const next = point(event), other = [...pointers.current.entries()].find(
      ([id2]) => id2 !== event.pointerId
    )?.[1];
    if (other) {
      const before = Math.hypot(previous.x - other.x, previous.y - other.y), after = Math.hypot(next.x - other.x, next.y - other.y), oldCenter = {
        x: (previous.x + other.x) / 2,
        y: (previous.y + other.y) / 2
      }, newCenter = { x: (next.x + other.x) / 2, y: (next.y + other.y) / 2 }, scaled = zoomView(
        live.current,
        before > 0 ? Math.max(0.01, after / before) : 1,
        oldCenter,
        minScale,
        maxScale
      );
      update({
        ...scaled,
        x: scaled.x + newCenter.x - oldCenter.x,
        y: scaled.y + newCenter.y - oldCenter.y
      });
    } else
      update({
        ...live.current,
        x: live.current.x + next.x - previous.x,
        y: live.current.y + next.y - previous.y
      });
    pointers.current.set(event.pointerId, next);
  }
  const release = (event) => pointers.current.delete(event.pointerId);
  function revealFocus(event) {
    const node = viewport.current;
    if (!node || event.target === node || !(event.target instanceof Element))
      return;
    const rect = node.getBoundingClientRect(), target = event.target.getBoundingClientRect(), dx = target.left < rect.left ? rect.left - target.left : target.right > rect.right ? rect.right - target.right : 0, dy = target.top < rect.top ? rect.top - target.top : target.bottom > rect.bottom ? rect.bottom - target.bottom : 0;
    if (dx || dy) {
      interacted.current = true;
      update({
        ...live.current,
        x: live.current.x + dx,
        y: live.current.y + dy
      });
    }
    node.scrollLeft = 0;
    node.scrollTop = 0;
  }
  function key(event) {
    if (event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey)
      return;
    if (event.key === "+" || event.key === "=") zoom(1.2);
    else if (event.key === "-") zoom(1 / 1.2);
    else if (event.key === "Home" || event.key === "0") {
      interacted.current = false;
      reset(true);
    } else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      interacted.current = true;
      const distance = Math.min(box.width, box.height) / 10;
      update({
        ...live.current,
        x: live.current.x + (event.key === "ArrowLeft" ? distance : event.key === "ArrowRight" ? -distance : 0),
        y: live.current.y + (event.key === "ArrowUp" ? distance : event.key === "ArrowDown" ? -distance : 0)
      });
    } else return;
    event.preventDefault();
  }
  return /* @__PURE__ */ jsxs("div", { "data-pan-zoom": true, className: styles.root({ class: className }), children: [
    /* @__PURE__ */ jsx("p", { id: `${id}-instructions`, className: "sr-only", children: instructions }),
    /* @__PURE__ */ jsxs(
      "div",
      {
        ref: viewport,
        className: styles.viewport(),
        role: "region",
        "aria-label": label,
        "aria-describedby": `${id}-instructions`,
        tabIndex: 0,
        style: {
          height: aspectRatio === void 0 ? `calc(var(--reddb-spatial-control-height-md) * ${rows[size]})` : void 0,
          aspectRatio,
          maxHeight: `calc(var(--reddb-spatial-control-height-md) * ${rows[size]})`
        },
        onKeyDown: key,
        onPointerDown: down,
        onPointerMove: move,
        onPointerUp: release,
        onPointerCancel: release,
        onLostPointerCapture: release,
        onFocus: revealFocus,
        children: [
          /* @__PURE__ */ jsx(
            "div",
            {
              "data-pan-zoom-content": true,
              className: styles.content(),
              style: {
                width: `${contentWidth}px`,
                height: `${contentHeight}px`,
                transform: `translate(${current.x}px, ${current.y}px) scale(${current.scale})`
              },
              children
            }
          ),
          overlay?.(current)
        ]
      }
    ),
    showControls && (controls ? controls({
      zoomIn: () => zoom(1.2),
      zoomOut: () => zoom(1 / 1.2),
      reset: () => reset(true),
      view: current
    }) : /* @__PURE__ */ jsxs(
      "div",
      {
        className: styles.controls(),
        role: "group",
        "aria-label": `${label} controls`,
        children: [
          /* @__PURE__ */ jsx(
            Button,
            {
              size: "sm",
              variant: "secondary",
              disabled: current.scale >= maxScale,
              onClick: () => zoom(1.2),
              children: zoomInLabel
            }
          ),
          /* @__PURE__ */ jsx(
            Button,
            {
              size: "sm",
              variant: "secondary",
              disabled: current.scale <= minScale,
              onClick: () => zoom(1 / 1.2),
              children: zoomOutLabel
            }
          ),
          /* @__PURE__ */ jsxs("span", { className: styles.status(), "aria-live": "off", children: [
            Math.round(current.scale * 100),
            "%"
          ] }),
          /* @__PURE__ */ jsx(
            Button,
            {
              size: "sm",
              variant: "ghost",
              onClick: () => {
                interacted.current = false;
                reset(true);
              },
              children: fitLabel
            }
          )
        ]
      }
    ))
  ] });
}
var PanZoomViewport_default = PanZoomViewport;
export {
  PanZoomViewport,
  PanZoomViewport_default as default
};
