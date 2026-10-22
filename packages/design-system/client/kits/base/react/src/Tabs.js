"use client";
import { jsx, jsxs } from "react/jsx-runtime";
import { useEffect, useId, useLayoutEffect, useRef } from "react";
import { Tabs as Managed } from "@base-ui/react/tabs";
import { Button } from "./Button.js";
import { tabs } from "../../src/tabs.variants.js";
import { useValue } from "./state.js";
function Tabs(props) {
  const { label, items, value = "", orientation = "horizontal", disabled = false, followHash = false, onValueChange, children, className, listClass, triggerClass, contentClass } = props;
  const [current, setCurrent] = useValue(props.value, value, onValueChange), id = useId(), element = useRef(null), styles = tabs();
  useLayoutEffect(() => {
    for (const tab of element.current?.querySelectorAll('[role="tab"]') ?? []) {
      tab.disabled = disabled || !!items.find((item) => item.value === tab.dataset.tabKey)?.disabled;
    }
  }, [disabled, items]);
  const selected = items.some((item) => !item.disabled && item.value === current) ? current : items.find((item) => !item.disabled)?.value ?? "";
  const latest = useRef({ items, selected });
  latest.current = { items, selected };
  useEffect(() => {
    if (!followHash) return;
    let pending;
    const selectFragment = () => {
      let fragment;
      try {
        fragment = decodeURIComponent(location.hash.slice(1));
      } catch {
        return;
      }
      const target = document.getElementById(fragment);
      if (!target || !element.current?.contains(target)) return;
      const panel = [...element.current.querySelectorAll("[data-tabs-owner]")].find((panel2) => panel2.dataset.tabsOwner === id && panel2.contains(target));
      const next = panel?.dataset.tabValue;
      if (!next || !latest.current.items.some((item) => !item.disabled && item.value === next)) return;
      if (next !== latest.current.selected) setCurrent(next);
      clearTimeout(pending);
      pending = setTimeout(() => {
        const target2 = document.getElementById(fragment);
        target2?.focus({ preventScroll: true });
        target2?.scrollIntoView?.({ block: "nearest" });
      }, 0);
    };
    selectFragment();
    window.addEventListener("hashchange", selectFragment);
    return () => {
      clearTimeout(pending);
      window.removeEventListener("hashchange", selectFragment);
    };
  }, [followHash, id, setCurrent]);
  return /* @__PURE__ */ jsx("div", { ref: element, "data-tabs": true, "aria-label": label, className: styles.root({ class: className }), children: /* @__PURE__ */ jsxs(Managed.Root, { value: selected, onValueChange: (next) => {
    if (typeof next === "string" && next !== selected && !disabled) setCurrent(next);
  }, orientation, "aria-label": label, children: [
    /* @__PURE__ */ jsx(Managed.List, { "aria-label": label, activateOnFocus: true, className: styles.list({ class: listClass }), children: items.map((item) => /* @__PURE__ */ jsx(Managed.Tab, { value: item.value, "data-tab-key": item.value, disabled: disabled || item.disabled, "data-state": selected === item.value ? "active" : "inactive", className: styles.trigger({ class: triggerClass }), render: (native) => /* @__PURE__ */ jsx(Button, { ...native, variant: "ghost", size: "sm", disabled: disabled || item.disabled }), children: item.label }, item.value)) }),
    items.map((item) => /* @__PURE__ */ jsx(Managed.Panel, { value: item.value, keepMounted: true, hidden: selected !== item.value, tabIndex: 0, "data-tabs-owner": id, "data-tab-value": item.value, className: styles.content({ class: contentClass }), children: children?.({ value: item.value }) }, item.value))
  ] }) });
}
export {
  Tabs
};
