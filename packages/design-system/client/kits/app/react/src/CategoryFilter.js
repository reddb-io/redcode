"use client";
import { jsx } from "react/jsx-runtime";
import { useImperativeHandle, useRef } from "react";
import { Checkbox, Fieldset, useControllableValue, useNativeFormReset } from "@reddb-io/design-system/base";
import { categoryValues } from "../../src/core/category-filter.js";
import { categoryFilter } from "../../src/composites/category-filter.variants.js";
function CategoryFilter(props) {
  const { legend, options, value, name, disabled = false, className, listClass, optionClass, onValueChange, ref, ...rest } = props;
  const [active, setActive, resetActive] = useControllableValue(props.value, value ?? [], onValueChange), root = useRef(null), initial = useRef(value ?? []), styles = categoryFilter();
  useImperativeHandle(ref, () => root.current, []);
  useNativeFormReset(root, () => resetActive(props.value ?? initial.current));
  return /* @__PURE__ */ jsx(Fieldset, { ...rest, ref: root, legend, disabled, "data-category-filter": true, className: styles.root({ class: className }), children: () => /* @__PURE__ */ jsx("div", { "data-category-filter-list": true, className: styles.list({ class: listClass }), children: options.map((option) => /* @__PURE__ */ jsx(Checkbox, { label: option.label, name, value: option.value, checked: active.includes(option.value), disabled: disabled || option.disabled, fieldClass: styles.option({ class: optionClass }), onCheckedChange: (checked) => setActive(categoryValues(active, option.value, checked)) }, option.value)) }) });
}
export {
  CategoryFilter
};
