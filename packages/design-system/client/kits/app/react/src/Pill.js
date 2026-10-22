"use client";
import { jsx, jsxs } from "react/jsx-runtime";
import { useEffect } from "react";
import { quietControl, warnDeprecated } from "@reddb-io/design-system/base";
import { pill, pillDismiss } from "../../src/primitives/pill.variants.js";
function Pill({ tone = "neutral", variant = "tinted", size = "md", onDismiss, dismissLabel = "Remove", children, className, ...rest }) {
  useEffect(() => {
    if (variant === "neutral" || variant === "primary") warnDeprecated("Pill", `variant="${variant}"`, 'a tone with variant="tinted" or variant="filled"');
  }, [variant]);
  return /* @__PURE__ */ jsxs("span", { ...rest, "data-pill": true, "data-tone": tone, "data-variant": variant, className: pill({ tone, variant, size, class: className }), children: [
    children,
    onDismiss && /* @__PURE__ */ jsx("button", { type: "button", "data-pill-dismiss": true, "aria-label": dismissLabel, className: quietControl({ ink: "inherit", class: pillDismiss() }), onClick: onDismiss, children: /* @__PURE__ */ jsx("span", { "aria-hidden": "true", children: "\xD7" }) })
  ] });
}
export {
  Pill
};
