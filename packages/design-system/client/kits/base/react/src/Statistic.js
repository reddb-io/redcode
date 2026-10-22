"use client";
import { jsx, jsxs } from "react/jsx-runtime";
import { useEffect, useRef } from "react";
import { valuePresentation } from "../../src/core/operational-motion.js";
import { statistic } from "../../src/statistic.variants.js";
import { DescriptionList } from "./DescriptionList.js";
function Statistic({
  label,
  value,
  formatValue = String,
  description,
  animate = false,
  className,
  ...rest
}) {
  const reading = useRef(null), presentation = useRef(null);
  useEffect(() => {
    if (reading.current) {
      presentation.current = valuePresentation(reading.current);
      presentation.current.update(value, animate);
    }
    return () => {
      presentation.current?.destroy();
      presentation.current = null;
    };
  }, []);
  useEffect(() => {
    presentation.current?.update(value, animate);
  }, [value, animate]);
  const slots = statistic();
  const detail = /* @__PURE__ */ jsxs("span", { className: slots.detail(), children: [
    /* @__PURE__ */ jsx(
      "data",
      {
        ref: reading,
        "data-statistic-value": true,
        value: String(value),
        className: slots.value(),
        children: formatValue(value)
      }
    ),
    description !== void 0 && /* @__PURE__ */ jsx("span", { "data-statistic-description": true, className: slots.description(), children: description })
  ] });
  return /* @__PURE__ */ jsx(
    DescriptionList,
    {
      ...rest,
      "data-statistic": true,
      items: [{ term: label, detail }],
      className: slots.root({ class: className })
    }
  );
}
export {
  Statistic
};
