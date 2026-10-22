import { tv } from "tailwind-variants";
import { popover } from "./popover.variants.js";
const linkPreview = tv({
  extend: popover,
  base: "select-text"
});
export {
  linkPreview
};
