"use client";
import { jsx } from "react/jsx-runtime";
import { skipLink } from "../../src/skip-link.variants.js";
import { focusSkipTarget } from "../../src/core/skip-link.js";
function SkipLink({ href = "#main-content", onClick, className, children, ...rest }) {
  return /* @__PURE__ */ jsx("a", { ...rest, href, "data-skip-link": true, className: skipLink({ class: className }), onClick: (event) => {
    onClick?.(event);
    focusSkipTarget(event, href, event.currentTarget.ownerDocument);
  }, children: children ?? "Skip to main content" });
}
export {
  SkipLink
};
