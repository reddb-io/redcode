"use client";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { useEffect, useImperativeHandle, useRef, useState } from "react";
import { Fieldset } from "./Fieldset.js";
import { ToggleButton } from "./ToggleButton.js";
import { toggleGroup } from "../../src/toggle-group.variants.js";
import { toggleGroupTarget, toggleGroupValue } from "../../src/core/toggle-group.js";
import { afterFormReset, associatedForm } from "../../src/core/native-controls.js";
function ToggleGroup({ legend, options, value, defaultValue, name, disabled = false, help, error, className, listClass, optionClass, onValueChange, ref, ...rest }) {
  const [local, setLocal] = useState(defaultValue);
  const initial = useRef(defaultValue);
  const currentValue = useRef(value);
  currentValue.current = value;
  const selected = toggleGroupValue(options, value ?? local), styles = toggleGroup({ invalid: Boolean(error) });
  const element = useRef(null), list = useRef(null);
  useImperativeHandle(ref, () => element.current, []);
  useEffect(() => afterFormReset(associatedForm(element.current, rest.form), () => {
    if (currentValue.current === void 0) setLocal(initial.current);
  }), [rest.form]);
  function choose(index) {
    const option = options[index];
    if (!option || disabled || element.current?.matches(":disabled") || option.disabled || option.value === selected) return;
    if (value === void 0) setLocal(option.value);
    onValueChange?.(option.value);
  }
  return /* @__PURE__ */ jsx(Fieldset, { ...rest, ref: element, legend, disabled, help, error, className: styles.root({ class: className }), "data-toggle-group": true, children: (control) => /* @__PURE__ */ jsxs(Fragment, { children: [
    /* @__PURE__ */ jsx("div", { ref: list, className: styles.list({ class: listClass }), role: "group", "aria-label": legend, children: options.map((option, index) => /* @__PURE__ */ jsx(
      ToggleButton,
      {
        ...control,
        label: option.label,
        pressed: option.value === selected,
        allowUnpress: false,
        disabled: disabled || option.disabled,
        className: styles.option({ class: optionClass }),
        tabIndex: option.value === selected ? 0 : -1,
        "data-toggle-value": option.value,
        onClick: () => choose(index),
        onKeyDown: (event) => {
          if (disabled || element.current?.matches(":disabled")) return;
          const next = toggleGroupTarget(options, index, event.key, getComputedStyle(list.current).direction === "rtl");
          if (next === void 0) return;
          event.preventDefault();
          choose(next);
          list.current?.querySelectorAll("button")[next]?.focus();
        }
      },
      option.value
    )) }),
    name && /* @__PURE__ */ jsx("input", { type: "hidden", name, value: selected, disabled, form: rest.form })
  ] }) });
}
export {
  ToggleGroup
};
