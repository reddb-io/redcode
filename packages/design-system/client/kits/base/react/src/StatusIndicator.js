import { jsx, jsxs } from "react/jsx-runtime";
import { statusIndicator } from "../../src/status-indicator.variants.js";
function StatusIndicator({ label, tone, showLabel = true, className, ...rest }) {
  const resolvedTone = tone ?? "neutral";
  const slots = statusIndicator({ tone: resolvedTone, labelled: showLabel });
  return /* @__PURE__ */ jsxs("span", { ...rest, "data-status-indicator": true, "data-tone": resolvedTone, "data-status": resolvedTone, className: slots.root({ class: className }), children: [
    /* @__PURE__ */ jsx("span", { "data-status-mark": true, "aria-hidden": "true", className: slots.mark() }),
    /* @__PURE__ */ jsx("span", { "data-status-label": true, className: slots.label(), children: label })
  ] });
}
export {
  StatusIndicator
};
