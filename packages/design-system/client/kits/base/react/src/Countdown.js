import { jsx, jsxs } from "react/jsx-runtime";
import { durationAttribute, formatDuration, normalizeRemaining } from "../../src/countdown.behavior.js";
import { countdown } from "../../src/countdown.variants.js";
function Countdown({ remaining, label = "Time remaining", completeLabel = "Complete", formatValue = formatDuration, className, ...rest }) {
  const seconds = normalizeRemaining(remaining);
  const complete = seconds === 0;
  const slots = countdown();
  return /* @__PURE__ */ jsxs("div", { ...rest, "data-countdown": true, "data-state": complete ? "complete" : "running", role: complete ? "status" : "timer", "aria-live": complete ? "polite" : "off", "aria-atomic": "true", className: slots.root({ class: className }), children: [
    /* @__PURE__ */ jsx("span", { "data-countdown-label": true, className: slots.label(), children: label }),
    /* @__PURE__ */ jsx("time", { dateTime: durationAttribute(seconds), className: slots.value(), children: complete ? completeLabel : formatValue(seconds) })
  ] });
}
export {
  Countdown
};
