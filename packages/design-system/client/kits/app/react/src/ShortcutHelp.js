import { jsx, jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { Dialog, Kbd } from "@reddb-io/design-system/base";
import { shortcutGroups } from "../../src/core/shortcut-help.js";
import { shortcutHelp } from "../../src/shortcut-help.variants.js";
function ShortcutHelp(props) {
  const {
    title,
    groups,
    triggerLabel,
    open = false,
    onopenchange,
    emptyLabel = "No shortcuts available",
    className
  } = props;
  const s = shortcutHelp(), visible = shortcutGroups(groups), [local, setLocal] = useState(false);
  return /* @__PURE__ */ jsx(
    Dialog,
    {
      title,
      triggerLabel,
      open: props.open === void 0 ? local : open,
      onOpenChange: (next) => {
        if (props.open === void 0) setLocal(next);
        onopenchange?.(next);
      },
      children: /* @__PURE__ */ jsxs("div", { "data-shortcut-help": true, className: s.root({ class: className }), children: [
        visible.map((group) => /* @__PURE__ */ jsxs(
          "section",
          {
            className: s.group(),
            "aria-label": group.label,
            children: [
              /* @__PURE__ */ jsx("h3", { className: s.title(), children: group.label }),
              group.description && /* @__PURE__ */ jsx("p", { className: s.description(), children: group.description }),
              /* @__PURE__ */ jsx("ul", { className: s.list(), children: group.items.map((item) => /* @__PURE__ */ jsxs("li", { className: s.item(), children: [
                /* @__PURE__ */ jsx("span", { className: s.name(), children: item.label }),
                /* @__PURE__ */ jsx("span", { className: s.keys(), children: item.keys.map((key, index) => /* @__PURE__ */ jsx(Kbd, { keys: [key], size: "sm" }, index)) })
              ] }, item.id)) })
            ]
          },
          group.id
        )),
        !visible.length && /* @__PURE__ */ jsx("p", { className: s.description(), children: emptyLabel })
      ] })
    }
  );
}
var ShortcutHelp_default = ShortcutHelp;
export {
  ShortcutHelp,
  ShortcutHelp_default as default
};
