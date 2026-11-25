"use client";
import { jsx, jsxs } from "react/jsx-runtime";
import { Meter } from "@reddb-io/design-system/base";
import { usageTone } from "../../src/core/contracts/usagemeter.js";
import { usageMeter } from "../../src/composites/usage-meter.variants.js";
function UsageMeter({ label, used, limit, unit, segments = [], thresholds, format, className }) {
  const styles = usageMeter();
  const amount = format ?? ((value) => new Intl.NumberFormat().format(value));
  const tone = usageTone(used, limit, thresholds);
  return /* @__PURE__ */ jsxs("div", { "data-usage-meter": true, "data-tone": tone, className: styles.root({ class: className }), children: [
    /* @__PURE__ */ jsx(Meter, { label, value: Math.min(used, limit), min: 0, max: limit, tone, formatValue: () => `${amount(used)} / ${amount(limit)} ${unit}` }),
    segments.length > 0 && /* @__PURE__ */ jsx("ul", { className: styles.segments(), "aria-label": `${label} breakdown`, children: segments.map((segment) => /* @__PURE__ */ jsxs("li", { className: styles.segment(), children: [
      /* @__PURE__ */ jsx("span", { children: segment.label }),
      /* @__PURE__ */ jsxs("span", { className: styles.amount(), children: [
        amount(segment.value),
        " ",
        unit
      ] })
    ] }, segment.id)) })
  ] });
}
export {
  UsageMeter
};
