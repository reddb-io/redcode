import { tv } from "tailwind-variants";
import { typeRoleMerge } from "./type-roles.js";
import { checkbox, choiceBox } from "./checkbox.variants.js";
import { fieldset } from "./fieldset.variants.js";
const choice = checkbox();
const radioGroup = tv({
  slots: {
    root: fieldset().root(),
    list: "grid gap-[var(--reddb-spatial-gap-sm)]",
    option: [
      "flex cursor-pointer items-center gap-[var(--reddb-spatial-gap-sm)] text-label font-regular text-foreground",
      "has-disabled:cursor-not-allowed has-disabled:text-ink-muted"
    ].join(" "),
    choice: choice.root(),
    control: choice.control(),
    box: [choiceBox, "rounded-full"].join(" "),
    dot: [
      "pointer-events-none invisible col-start-1 row-start-1 peer-checked:visible",
      "size-[calc(var(--reddb-spatial-icon-size-md)*0.4)] rounded-full bg-on-primary",
      "forced-colors:hidden"
    ].join(" "),
    content: "grid min-w-0 gap-[var(--reddb-spatial-gap-sm)]",
    label: "",
    description: "text-caption text-ink-muted"
  },
  variants: {
    variant: {
      list: {},
      cards: {
        root: "@container/radio-cards",
        list: "grid-cols-1 @lg/radio-cards:grid-cols-2",
        option: "items-start rounded-md border border-control-edge p-[var(--reddb-spatial-inset-md)] has-checked:bg-state-selected has-checked:border-foreground has-disabled:cursor-not-allowed has-disabled:opacity-50 hover:bg-state-hover has-checked:hover:bg-state-selected active:bg-state-pressed",
        label: "text-body font-medium"
      }
    }
  },
  defaultVariants: { variant: "list" }
}, typeRoleMerge);
export {
  radioGroup
};
