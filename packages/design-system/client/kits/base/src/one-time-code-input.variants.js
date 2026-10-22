import { tv } from "tailwind-variants";
import { typeRoleMerge } from "./type-roles.js";
import { fieldset } from "./fieldset.variants.js";
import { input } from "./input.variants.js";
const oneTimeCodeInput = tv({
  slots: {
    root: fieldset().root(),
    list: "flex flex-wrap gap-[var(--reddb-spatial-gap-sm)]",
    segment: [
      input(),
      // A centered single character needs the whole square, without text-field insets.
      "w-[var(--reddb-spatial-control-height-md)] px-0 text-center"
    ].join(" "),
    help: fieldset().help(),
    error: fieldset().error()
  }
}, typeRoleMerge);
export {
  oneTimeCodeInput
};
