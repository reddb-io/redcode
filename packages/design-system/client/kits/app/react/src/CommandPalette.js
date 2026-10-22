"use client";
import { jsx } from "react/jsx-runtime";
import { Combobox, Popover, useControllableValue } from "@reddb-io/design-system/base";
import { commandPalette } from "../../src/composites/command-palette.variants.js";
function CommandPalette(props) {
  const { triggerLabel, contentLabel, label, commands = [], open = false, onOpenChange, disabled = false, className, contentClass, inputClass, onSelect } = props;
  const [active, setActive] = useControllableValue(props.open, open, onOpenChange), styles = commandPalette();
  return /* @__PURE__ */ jsx("div", { "data-command-palette": true, className: styles.root({ class: className }), children: /* @__PURE__ */ jsx(Popover, { triggerLabel, contentLabel, disabled, open: active, onOpenChange: setActive, className: styles.content({ class: contentClass }), children: /* @__PURE__ */ jsx(Combobox, { label, options: commands.map((command) => ({ value: command.id, label: command.label, disabled: command.disabled })), value: "", inputClass, className: styles.search(), onValueChange: (id) => {
    const command = commands.find((command2) => command2.id === id);
    if (!command) return;
    command.onselect?.();
    onSelect?.(command);
    setActive(false);
  } }) }) });
}
export {
  CommandPalette
};
