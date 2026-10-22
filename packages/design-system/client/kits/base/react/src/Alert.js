import { jsx, jsxs } from "react/jsx-runtime";
import { alert } from "../../src/alert.variants.js";
import { feedbackTone, feedbackAnnouncement } from "../../src/core/feedback.js";
function Alert({ tone, title, className, children, ...rest }) {
  const resolvedTone = feedbackTone(tone);
  const hasBody = children !== void 0 && children !== null && children !== false;
  return /* @__PURE__ */ jsxs("div", { ...rest, role: feedbackAnnouncement(resolvedTone), "data-tone": resolvedTone, className: alert({ tone: resolvedTone, class: className }), children: [
    title && /* @__PURE__ */ jsx("p", { className: "font-medium", children: title }),
    hasBody && /* @__PURE__ */ jsx("div", { className: title ? "mt-[var(--reddb-spatial-gap-sm)]" : void 0, children })
  ] });
}
export {
  Alert
};
