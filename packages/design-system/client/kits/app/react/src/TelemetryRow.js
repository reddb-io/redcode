import { jsx, jsxs } from "react/jsx-runtime";
import { Meter, StatusIndicator } from "@reddb-io/design-system/base";
import { operational } from "../../src/operational.variants.js";
function TelemetryRow({
  label,
  value,
  max = 100,
  stateLabel,
  condition,
  description,
  tone = "neutral",
  className
}) {
  const s = operational();
  return /* @__PURE__ */ jsxs("div", { "data-telemetry-row": true, className: s.body({ class: className }), children: [
    /* @__PURE__ */ jsxs("div", { className: s.header(), children: [
      /* @__PURE__ */ jsx("p", { className: s.title(), children: label }),
      stateLabel && /* @__PURE__ */ jsx(StatusIndicator, { label: stateLabel, tone })
    ] }),
    /* @__PURE__ */ jsx(
      Meter,
      {
        value,
        max,
        label,
        layout: "inline",
        labelHidden: true,
        formatValue: (n) => `${n} / ${Math.max(1, max)}`
      }
    ),
    (description || condition) && /* @__PURE__ */ jsxs("div", { className: s.row(), children: [
      description && /* @__PURE__ */ jsx("span", { className: s.description(), children: description }),
      condition && /* @__PURE__ */ jsx("span", { className: s.description(), children: condition })
    ] })
  ] });
}
export {
  TelemetryRow
};
