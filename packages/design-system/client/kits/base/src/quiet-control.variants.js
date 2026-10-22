import { tv } from "tailwind-variants";
import { typeRoleMerge } from "./type-roles.js";
const QUIET_HOVER = "hover:bg-foreground/8";
const QUIET_PRESSED = "active:bg-foreground/12";
const QUIET_OPEN = "[&[aria-haspopup][aria-expanded=true]]:bg-foreground/10";
const QUIET_FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";
const QUIET_DISABLED = "disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50";
const INK = {
  /** Secondary ink at rest, full ink under the pointer: a ghost Button, a close "×". */
  muted: "text-ink-muted hover:text-foreground",
  /** Full ink throughout: a menu trigger or a row whose label is the content. */
  foreground: "text-foreground",
  /** The caller's colour (a tone, the surrounding text). */
  inherit: ""
};
const FOCUS = {
  /** The default: 2px outside the control, on the ground. */
  offset: QUIET_FOCUS,
  /** Inside the control, where a scroll region or a tight rail would clip it. */
  inset: "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
};
const SELECTED = {
  /** Current, selected or pressed: the selected surface, which the pointer does not lighten. */
  true: "bg-foreground/10 hover:bg-foreground/10 font-medium text-foreground hover:text-foreground",
  false: ""
};
const quietControl = tv({
  base: [
    // No colour transition: a state lands at full contrast the moment it
    // starts. Easing colours faded the focus ring in from the text colour, and
    // made a Color Scheme switch repaint every control through intermediate
    // colours that fail AA for 150ms.
    "bg-transparent",
    QUIET_HOVER,
    QUIET_PRESSED,
    QUIET_OPEN,
    QUIET_DISABLED
  ].join(" "),
  variants: { ink: INK, focus: FOCUS, selected: SELECTED },
  defaultVariants: { ink: "muted", focus: "offset", selected: false }
}, typeRoleMerge);
const QUIET_CONTROL_INKS = Object.keys(INK);
const QUIET_CONTROL_FOCUS = Object.keys(FOCUS);
export {
  QUIET_CONTROL_FOCUS,
  QUIET_CONTROL_INKS,
  QUIET_DISABLED,
  QUIET_FOCUS,
  QUIET_HOVER,
  QUIET_OPEN,
  QUIET_PRESSED,
  quietControl
};
