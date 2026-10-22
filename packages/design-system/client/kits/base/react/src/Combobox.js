"use client";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { useRef } from "react";
import { Combobox as Managed } from "@base-ui/react/combobox";
import { Field } from "./Field.js";
import { input } from "../../src/input.variants.js";
import { combobox } from "../../src/combobox.variants.js";
import { popover } from "../../src/popover.variants.js";
import { usePortalAppearance, useValue } from "./state.js";
function Combobox(props) {
  const { label, options, name, value = "", inputValue = options.find((option) => option.value === value)?.label ?? "", help, error, required = false, disabled = false, placeholder, open = false, controlSize = "md", className, inputClass, contentClass, itemClass, onValueChange, onInputValueChange, onOpenChange } = props;
  const [selected, setSelected] = useValue(props.value, "", onValueChange), [text, setText] = useValue(props.inputValue, options.find((option) => option.value === selected)?.label ?? "", onInputValueChange);
  const [active, setActive] = useValue(props.open, open, onOpenChange), anchor = useRef(null), portal = usePortalAppearance(anchor, active), styles = combobox({ size: controlSize });
  const query = text.trim().toLocaleLowerCase(), filtered = query ? options.filter((option) => option.label.toLocaleLowerCase().includes(query)) : options;
  return /* @__PURE__ */ jsx(Field, { label, help, error, required, className: styles.root({ class: className }), children: (control) => /* @__PURE__ */ jsxs(
    Managed.Root,
    {
      items: options.map((option) => option.value),
      value: selected || null,
      onValueChange: (next) => {
        setSelected(next ?? "");
        setText(options.find((option) => option.value === next)?.label ?? "");
      },
      inputValue: text,
      onInputValueChange: setText,
      open: active,
      onOpenChange: setActive,
      disabled,
      name,
      required,
      itemToStringLabel: (value2) => options.find((option) => option.value === value2)?.label ?? "",
      children: [
        /* @__PURE__ */ jsx("div", { className: styles.control(), "data-combobox": true, children: /* @__PURE__ */ jsx(Managed.Input, { ...control, ref: anchor, placeholder, className: input({ size: controlSize, class: styles.input({ class: inputClass }) }) }) }),
        /* @__PURE__ */ jsx(Managed.Portal, { container: portal.container, children: /* @__PURE__ */ jsx(Managed.Positioner, { ...portal.attributes, sideOffset: 8, collisionPadding: 8, children: /* @__PURE__ */ jsxs(Managed.Popup, { "data-combobox-surface": true, "data-avoid-collisions": "true", className: popover({ class: styles.content({ class: contentClass }) }), children: [
          /* @__PURE__ */ jsx(Managed.List, { children: filtered.map((option) => /* @__PURE__ */ jsxs(Managed.Item, { value: option.value, disabled: option.disabled, className: styles.item({ class: itemClass }), children: [
            /* @__PURE__ */ jsx("span", { className: "min-w-0 break-words", children: option.label }),
            option.value === selected && /* @__PURE__ */ jsxs(Fragment, { children: [
              /* @__PURE__ */ jsx("span", { "aria-hidden": "true", className: styles.indicator(), children: "\u2713" }),
              /* @__PURE__ */ jsx("span", { className: "sr-only", children: "Selected" })
            ] })
          ] }, option.value)) }),
          filtered.length === 0 && /* @__PURE__ */ jsx("span", { "data-combobox-empty": true, className: styles.empty(), children: "No matching options" })
        ] }) }) })
      ]
    }
  ) });
}
export {
  Combobox
};
