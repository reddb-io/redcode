"use client";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from "react";
import { Combobox as Managed } from "@base-ui/react/combobox";
import { Button, Dialog, Field, Kbd, Popover, quietControl, useControllableValue } from "@reddb-io/design-system/base";
import { input, combobox } from "@reddb-io/design-system/base/recipes";
import { commandGroups } from "../../src/composites/command-palette.behavior.js";
import { commandPalette } from "../../src/composites/command-palette.variants.js";
function CommandPalette(props) {
  const {
    triggerLabel,
    contentLabel,
    label,
    commands = [],
    open = false,
    onOpenChange,
    disabled = false,
    className,
    contentClass,
    inputClass,
    onSelect,
    presentation = "popover",
    placeholder,
    emptyLabel = "No matching commands"
  } = props;
  const [active, setActive] = useControllableValue(props.open, open, onOpenChange);
  const pending = useRef(null);
  const [query, setQuery] = useState("");
  useEffect(() => {
    if (!active) setQuery("");
  }, [active]);
  useEffect(() => {
    if (active || !pending.current) return;
    const command = pending.current;
    pending.current = null;
    command.onselect?.();
    onSelect?.(command);
  }, [active, onSelect]);
  const s = commandPalette(), c = combobox(), groups = commandGroups(commands, query);
  const search = active && /* @__PURE__ */ jsx(Field, { label, className: s.search(), children: (control) => /* @__PURE__ */ jsxs(
    Managed.Root,
    {
      inline: true,
      open: true,
      autoHighlight: true,
      onOpenChange: (next) => {
        if (!next) setActive(false);
      },
      items: groups.flatMap((group) => group.items.map((item) => item.id)),
      filter: null,
      value: null,
      inputValue: query,
      onInputValueChange: setQuery,
      disabled,
      itemToStringLabel: (id) => commands.find((command) => command.id === id)?.label ?? "",
      onValueChange: (id) => {
        const command = commands.find((item) => item.id === id);
        if (!command || command.disabled) return;
        if (presentation === "popover") {
          command.onselect?.();
          onSelect?.(command);
        }
        if (presentation === "dialog") pending.current = command;
        setActive(false);
        setQuery("");
      },
      children: [
        /* @__PURE__ */ jsx(Managed.Input, { ...control, placeholder, className: input({ class: inputClass }) }),
        /* @__PURE__ */ jsx(Managed.List, { "aria-label": label, className: s.list(), children: groups.map((group) => /* @__PURE__ */ jsxs(Managed.Group, { className: s.group(), children: [
          group.label && /* @__PURE__ */ jsx(Managed.GroupLabel, { className: s.heading(), children: group.label }),
          group.items.map((command) => /* @__PURE__ */ jsxs(Managed.Item, { value: command.id, disabled: command.disabled, "aria-disabled": command.disabled || void 0, className: quietControl({ ink: "foreground", class: `group/command ${c.item()}` }), children: [
            /* @__PURE__ */ jsxs("span", { className: s.identity(), children: [
              /* @__PURE__ */ jsx("span", { children: command.label }),
              command.description && /* @__PURE__ */ jsx("span", { className: s.description(), children: command.description })
            ] }),
            !!command.shortcut?.length && /* @__PURE__ */ jsx("span", { className: s.keys(), "aria-hidden": "true", children: command.shortcut.map((key, index) => /* @__PURE__ */ jsx(Kbd, { keys: [key], size: "sm" }, index)) })
          ] }, command.id))
        ] }, group.label)) }),
        !groups.length && /* @__PURE__ */ jsx("p", { role: "status", className: c.empty(), children: emptyLabel })
      ]
    }
  ) });
  return /* @__PURE__ */ jsx("div", { "data-command-palette": true, className: s.root({ class: className }), children: presentation === "dialog" ? /* @__PURE__ */ jsxs(Fragment, { children: [
    triggerLabel && /* @__PURE__ */ jsx(Button, { size: "sm", disabled, "aria-haspopup": "dialog", "aria-expanded": active, onClick: () => setActive(true), children: triggerLabel }),
    /* @__PURE__ */ jsx(
      Dialog,
      {
        title: contentLabel,
        open: active,
        onOpenChange: setActive,
        initialFocus: "body",
        className: s.content({ class: contentClass }),
        children: search
      }
    )
  ] }) : /* @__PURE__ */ jsx(
    Popover,
    {
      triggerLabel: triggerLabel ?? contentLabel,
      contentLabel,
      disabled,
      open: active,
      onOpenChange: setActive,
      className: s.content({ class: contentClass }),
      children: search
    }
  ) });
}
export {
  CommandPalette
};
