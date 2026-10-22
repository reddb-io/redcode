import { jsx } from "react/jsx-runtime";
import { Button, Popover } from "@reddb-io/design-system/base";
import { speedDial } from "../../src/composites/speed-dial.variants.js";
function SpeedDial(props) {
  const { triggerLabel, contentLabel, actions = [], open = false, onOpenChange, disabled = false, size = "md", side = "top", align = "end", sideOffset = 8, collisionPadding = 8, trigger, className } = props;
  const styles = speedDial({ size });
  return /* @__PURE__ */ jsx("div", { "data-speed-dial": true, children: /* @__PURE__ */ jsx(Popover, { triggerLabel, contentLabel, open: props.open, onOpenChange, disabled, variant: "primary", size, side, align, sideOffset, collisionPadding, trigger, className: styles.content({ class: className }), children: actions.map((action) => /* @__PURE__ */ jsx(Button, { "data-speed-dial-action": true, href: action.href, disabled: action.disabled, variant: "ghost", size, className: styles.action(), onClick: action.href === void 0 ? () => action.onselect?.() : void 0, children: action.label }, action.id)) }) });
}
export {
  SpeedDial
};
