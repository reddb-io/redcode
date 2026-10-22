"use client";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from "react";
import { Combobox as Managed } from "@base-ui/react/combobox";
import { Field } from "./Field.js";
import { Button } from "./Button.js";
import { input } from "../../src/input.variants.js";
import { popover } from "../../src/popover.variants.js";
import { afterFormReset } from "../../src/core/native-controls.js";
import { searchSelect, searchSelectOptions } from "../../src/search-select.variants.js";
import { usePortalAppearance, useValue } from "./state.js";
function SearchSelect(props) {
  const { label, options, multiple = false, value = multiple ? [] : "", name, help, error, required = false, disabled = false, placeholder = "Choose an option", searchPlaceholder = "Search options", emptyText = "No matching options", requiredMessage = "Choose at least one option.", clearable = true, open = false, controlSize = "md", className, triggerClass, contentClass, onValueChange, onOpenChange } = props;
  const [current, setCurrent, resetCurrent] = useValue(props.value, value, (next) => {
    if (props.multiple) props.onValueChange?.(Array.isArray(next) ? next : []);
    else props.onValueChange?.(typeof next === "string" ? next : "");
  });
  const [active, setActive] = useValue(props.open, open, onOpenChange), [query, setQuery] = useState(""), [invalid, setInvalid] = useState(false);
  const anchor = useRef(null), search = useRef(null), native = useRef(null), initial = useRef(value), latest = useRef(props);
  latest.current = props;
  const portal = usePortalAppearance(anchor, active), styles = searchSelect(), selected = Array.isArray(current) ? current : current ? [current] : [];
  const labels = selected.map((value2) => options.find((option) => option.value === value2)?.label ?? value2), summary = labels.length > 1 ? `${labels.length} selected` : labels[0] ?? placeholder;
  const filtered = searchSelectOptions(options, query), fieldError = error ?? (invalid && !selected.length ? requiredMessage : void 0);
  const change = (next) => {
    setInvalid(false);
    setCurrent(next);
  };
  const changeOpen = (next) => {
    setQuery("");
    setActive(next);
  };
  useEffect(() => {
    if (!active) setQuery("");
  }, [active]);
  useEffect(() => {
    if (disabled && active) changeOpen(false);
  }, [disabled, active]);
  useEffect(() => afterFormReset(native.current?.form, () => {
    setInvalid(false);
    resetCurrent(latest.current.value ?? initial.current);
  }), [resetCurrent]);
  const remove = (value2) => {
    anchor.current?.focus();
    change(multiple ? selected.filter((item) => value2 !== void 0 && item !== value2) : "");
  };
  return /* @__PURE__ */ jsx(Field, { label, help, error: fieldError, required, className: styles.root({ class: className }), children: (control) => /* @__PURE__ */ jsxs("div", { className: "grid gap-[var(--reddb-spatial-gap-sm)]", "data-search-select": true, "data-multiple": multiple, children: [
    /* @__PURE__ */ jsxs("select", { ref: native, name, multiple, value: multiple ? selected : selected[0] ?? "", disabled, required, tabIndex: -1, "aria-hidden": "true", className: "sr-only", onChange: (event) => change(multiple ? [...event.currentTarget.selectedOptions].map((option) => option.value) : event.currentTarget.value), onInvalid: (event) => {
      event.preventDefault();
      setInvalid(true);
      const first = native.current?.form?.querySelector(":invalid");
      if (!first || first === native.current) anchor.current?.focus();
    }, children: [
      !multiple && /* @__PURE__ */ jsx("option", { value: "", children: placeholder }),
      options.map((option) => /* @__PURE__ */ jsx("option", { value: option.value, disabled: option.disabled, children: option.label }, option.value))
    ] }),
    /* @__PURE__ */ jsxs(Managed.Root, { multiple, value: multiple ? selected : selected[0] ?? null, onValueChange: (next) => {
      change(next ?? "");
      setQuery("");
      if (!multiple) changeOpen(false);
    }, inputValue: query, onInputValueChange: setQuery, open: active, onOpenChange: changeOpen, disabled, items: filtered.map((option) => option.value), filter: null, itemToStringLabel: (value2) => options.find((option) => option.value === value2)?.label ?? value2, children: [
      /* @__PURE__ */ jsxs("div", { className: styles.row(), children: [
        /* @__PURE__ */ jsxs(Managed.Trigger, { ref: anchor, render: (nativeProps) => /* @__PURE__ */ jsx(Button, { ...control, ...nativeProps, role: "button", "aria-haspopup": "dialog", disabled, size: controlSize, className: input({ size: controlSize, class: styles.trigger({ class: triggerClass }) }) }), "aria-label": `${summary}, ${label}${required ? ", required" : ""}`, "data-search-select-trigger": true, children: [
          /* @__PURE__ */ jsx("span", { className: styles.summary({ class: !selected.length ? styles.placeholder() : void 0 }), children: summary }),
          /* @__PURE__ */ jsx("span", { "aria-hidden": "true", children: "\u2304" })
        ] }),
        clearable && selected.length > 0 && /* @__PURE__ */ jsx(Button, { variant: "ghost", size: controlSize, disabled, className: styles.clear(), "aria-label": `Clear ${label}`, title: `Clear ${label}`, onClick: () => remove(), "data-search-select-clear": true, children: /* @__PURE__ */ jsx("span", { "aria-hidden": "true", children: "\xD7" }) })
      ] }),
      /* @__PURE__ */ jsx(Managed.Portal, { container: portal.container, children: /* @__PURE__ */ jsx(Managed.Positioner, { style: { "--bits-popover-anchor-width": "var(--anchor-width)", "--bits-popover-content-available-height": "var(--available-height)" }, ...portal.attributes, sideOffset: 8, collisionPadding: 8, align: "start", children: /* @__PURE__ */ jsxs(Managed.Popup, { role: "dialog", "aria-label": label, initialFocus: search, "data-search-select-surface": true, className: popover({ class: styles.content({ class: contentClass }) }), children: [
        /* @__PURE__ */ jsx(Managed.Input, { ref: search, "aria-label": `Search ${label}`, placeholder: searchPlaceholder, className: input({ size: controlSize, class: styles.search() }) }),
        /* @__PURE__ */ jsx(Managed.List, { className: styles.list(), children: filtered.map((option) => /* @__PURE__ */ jsxs(Managed.Item, { value: option.value, disabled: option.disabled, className: styles.item(), children: [
          /* @__PURE__ */ jsxs("span", { className: styles.option(), children: [
            option.label,
            option.description && /* @__PURE__ */ jsx("span", { className: styles.description(), children: option.description })
          ] }),
          selected.includes(option.value) && /* @__PURE__ */ jsxs(Fragment, { children: [
            /* @__PURE__ */ jsx("span", { "aria-hidden": "true", children: "\u2713" }),
            /* @__PURE__ */ jsx("span", { className: "sr-only", children: "Selected" })
          ] })
        ] }, option.value)) }),
        !filtered.length && /* @__PURE__ */ jsx("span", { role: "status", className: styles.empty(), children: emptyText })
      ] }) }) })
    ] }),
    multiple && selected.length > 0 && /* @__PURE__ */ jsx("ul", { className: styles.chips(), "aria-label": `Selected ${label}`, children: selected.map((value2, index) => /* @__PURE__ */ jsx("li", { className: "min-w-0 max-w-full", children: /* @__PURE__ */ jsxs(Button, { variant: "secondary", size: "sm", className: styles.chip(), disabled, "aria-label": `${labels[index]}, remove from ${label}`, onClick: () => remove(value2), "data-search-select-chip": true, children: [
      /* @__PURE__ */ jsx("span", { className: "min-w-0 truncate", children: labels[index] }),
      /* @__PURE__ */ jsx("span", { "aria-hidden": "true", children: "\xD7" })
    ] }) }, value2)) }),
    /* @__PURE__ */ jsx("span", { className: "sr-only", role: "status", children: labels.length ? labels.join(", ") : "No options selected" })
  ] }) });
}
export {
  SearchSelect
};
