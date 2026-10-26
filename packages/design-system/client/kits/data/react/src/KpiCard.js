"use client";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { useEffect } from "react";
import { warnDeprecated } from "@reddb-io/design-system/base";
import {
  kpiCard
} from "../../src/kpi-card.variants.js";
import {
  kpiDeltaDirection,
  kpiDeltaSentiment,
  formatKpiDelta
} from "../../src/core/kpi-card.js";
export * from "../../src/core/kpi-card.js";
function KpiCard(props) {
  const {
    label,
    value,
    delta,
    deltaSuffix = "%",
    deltaLabel = "versus previous period",
    description,
    polarity = "higher-is-better",
    tone = "neutral",
    sparkline,
    className = ""
  } = props;
  const direction = delta == null ? void 0 : kpiDeltaDirection(delta);
  const sentiment = delta == null ? void 0 : kpiDeltaSentiment(delta, polarity);
  const styles = kpiCard({
    tone,
    sentiment,
    trend: sparkline != null && sparkline !== false
  });
  useEffect(() => {
    if (tone === "brand") {
      warnDeprecated(
        "KpiCard",
        'tone="brand"',
        "a tone (neutral, info, success, warning, danger); the accent is an emphasis, not a tone"
      );
    }
  });
  return /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsxs(
    "section",
    {
      "data-kpi-card": true,
      "data-tone": tone,
      "data-delta-direction": direction,
      "data-delta-sentiment": sentiment,
      "data-polarity": polarity,
      "aria-label": label,
      className: styles.root({ class: className }),
      children: [
        /* @__PURE__ */ jsxs("div", { "data-kpi-reading": true, className: styles.reading(), children: [
          /* @__PURE__ */ jsx("p", { "data-kpi-label": true, className: styles.label(), children: label }),
          /* @__PURE__ */ jsx("p", { "data-kpi-value": true, className: styles.value(), children: value })
        ] }),
        (delta != null || description) && /* @__PURE__ */ jsxs("div", { "data-kpi-details": true, className: styles.details(), children: [
          delta != null ? /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsxs("div", { "data-kpi-context": true, className: styles.context(), children: [
            delta != null ? /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsxs("p", { "data-kpi-delta": true, className: styles.delta(), children: [
              /* @__PURE__ */ jsx("span", { "aria-hidden": "true", children: direction === "increase" ? "\u2191" : direction === "decrease" ? "\u2193" : "\u2192" }),
              /* @__PURE__ */ jsx("span", { "data-kpi-change": true, children: formatKpiDelta(delta, deltaSuffix) }),
              /* @__PURE__ */ jsx("span", { className: "sr-only", children: deltaLabel })
            ] }) }) : null,
            /* @__PURE__ */ jsx(
              "p",
              {
                "data-kpi-comparison": true,
                "aria-hidden": "true",
                className: styles.description(),
                children: deltaLabel
              }
            )
          ] }) }) : null,
          description ? /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx(
            "p",
            {
              "data-kpi-description": true,
              className: [styles.description(), "col-span-full"].filter(Boolean).join(" "),
              children: description
            }
          ) }) : null
        ] }),
        sparkline != null && sparkline !== false ? /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx("div", { "data-kpi-sparkline": true, className: styles.sparkline(), children: sparkline }) }) : null
      ]
    }
  ) });
}
var KpiCard_default = KpiCard;
export {
  KpiCard,
  KpiCard_default as default
};
