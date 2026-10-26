import { jsx } from "react/jsx-runtime";
import { KpiCard } from "./KpiCard.js";
import { Sparkline } from "./Sparkline.js";
import { uniqueEntities } from "../../src/operational.js";
import { operationalView } from "../../src/operational.variants.js";
function MetricStrip({ label, items, className }) {
  const s = operationalView();
  return /* @__PURE__ */ jsx(
    "div",
    {
      "data-metric-strip": true,
      role: "group",
      "aria-label": label,
      className: s.metrics({ class: className }),
      children: uniqueEntities(items, "MetricStrip").map((metric) => /* @__PURE__ */ jsx(
        KpiCard,
        {
          label: metric.label,
          value: metric.value,
          description: metric.description,
          delta: metric.delta,
          polarity: metric.polarity,
          sparkline: metric.values?.length ? /* @__PURE__ */ jsx(
            Sparkline,
            {
              values: metric.values,
              variant: metric.variant ?? "line",
              label: `${metric.label} trend`
            }
          ) : void 0
        },
        metric.id
      ))
    }
  );
}
var MetricStrip_default = MetricStrip;
export {
  MetricStrip,
  MetricStrip_default as default
};
