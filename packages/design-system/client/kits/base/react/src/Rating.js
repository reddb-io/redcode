"use client";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { useEffect, useId, useImperativeHandle, useRef, useState } from "react";
import { Fieldset } from "./Fieldset.js";
import { Label } from "./Label.js";
import { rating } from "../../src/rating.variants.js";
import { afterFormReset, ratingStops } from "../../src/core/native-controls.js";
function Rating({ legend, name, value, defaultValue = 0, onValueChange, max = 5, required = false, help, error, id, className, optionClass, controlClass, markClass, outputClass, ref, ...rest }) {
  const generated = useId();
  const prefix = id ?? `${generated}-rating`;
  const [local, setLocal] = useState(defaultValue);
  const initial = useRef(defaultValue);
  const element = useRef(null);
  const supplied = useRef(value);
  supplied.current = value;
  useImperativeHandle(ref, () => element.current, []);
  const current = value ?? local;
  const stops = ratingStops(max);
  const styles = rating();
  useEffect(() => {
    const root = element.current;
    return afterFormReset(root?.form, () => {
      const next = supplied.current ?? initial.current;
      if (supplied.current === void 0) setLocal(next);
      root?.querySelectorAll('input[type="radio"]').forEach((input) => {
        input.checked = Number(input.value) === next;
      });
    });
  }, [rest.form]);
  return /* @__PURE__ */ jsx(
    Fieldset,
    {
      ...rest,
      ref: element,
      legend,
      help,
      error,
      className: styles.root({ class: className }),
      "data-rating": true,
      children: (control) => /* @__PURE__ */ jsxs(Fragment, { children: [
        /* @__PURE__ */ jsx("div", { className: styles.list(), "data-rating-list": true, children: stops.map((stop) => /* @__PURE__ */ jsxs(Label, { className: styles.option({ class: optionClass }), htmlFor: `${prefix}-${stop}`, children: [
          /* @__PURE__ */ jsx(
            "input",
            {
              ...control,
              id: `${prefix}-${stop}`,
              type: "radio",
              name,
              value: stop,
              checked: current === stop,
              required,
              form: rest.form,
              onChange: (event) => {
                const next = Number(event.currentTarget.value);
                if (value === void 0) setLocal(next);
                onValueChange?.(next);
              },
              className: styles.control({ class: controlClass })
            }
          ),
          /* @__PURE__ */ jsx("span", { className: styles.mark({ class: markClass }), "data-rating-mark": true, "aria-hidden": "true", children: stop <= current ? "\u2605" : "\u2606" }),
          /* @__PURE__ */ jsxs("span", { className: "sr-only", children: [
            stop,
            " of ",
            stops.length
          ] })
        ] }, stop)) }),
        /* @__PURE__ */ jsx("output", { className: styles.output({ class: outputClass }), "aria-live": "polite", children: `${current} of ${stops.length}` })
      ] })
    }
  );
}
export {
  Rating
};
