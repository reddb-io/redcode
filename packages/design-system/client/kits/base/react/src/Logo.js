"use client";
import { jsx } from "react/jsx-runtime";
import { useSyncExternalStore } from "react";
import { DEFAULT_SYMBOL_PX, logoBox, px } from "../../src/logo.box.js";
import { selectMark } from "../../src/logo.marks.js";
import { activeSurface, observeActiveSurface } from "../../src/logo.surface.js";
import { logo, logoMark } from "../../src/logo.variants.js";
const lightSurface = () => "light";
const subscribeSurface = (notify) => observeActiveSurface(() => notify());
const noSubscription = () => () => {
};
function Logo({ layout = "horizontal", on, size = DEFAULT_SYMBOL_PX, loading = "eager", fetchpriority, label = "reddb.io home", className, style, ...rest }) {
  const observed = useSyncExternalStore(on === void 0 ? subscribeSurface : noSubscription, activeSurface, lightSurface);
  const surface = on ?? observed;
  const mark = selectMark(layout, surface);
  const box = logoBox(mark, size);
  const attributes = {
    className: logo({ interactive: rest.href !== void 0, class: className }),
    style: { ...style, padding: px(box.clearspace) },
    "data-logo-layout": layout,
    "data-logo-on": surface,
    "data-logo-mark": mark.file
  };
  const img = /* @__PURE__ */ jsx(
    "img",
    {
      src: mark.src,
      alt: rest.href !== void 0 ? "" : "RedDB",
      width: Math.round(box.markWidth),
      height: Math.round(box.markHeight),
      style: { width: px(box.markWidth), height: px(box.markHeight) },
      className: logoMark(),
      loading,
      fetchPriority: fetchpriority,
      decoding: "async",
      "aria-hidden": rest.href !== void 0 ? "true" : void 0
    },
    mark.file
  );
  if (rest.href !== void 0) return /* @__PURE__ */ jsx("a", { ...rest, ...attributes, "aria-label": label, children: img });
  return /* @__PURE__ */ jsx("span", { ...rest, ...attributes, children: img });
}
export {
  Logo
};
