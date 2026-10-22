import { tv } from "tailwind-variants";
const toggleButton = tv({
  base: [
    "aria-pressed:bg-foreground/10 aria-pressed:text-foreground",
    "aria-pressed:border-b-2 aria-pressed:border-b-foreground"
  ].join(" "),
  variants: {
    pressed: {
      true: "font-medium",
      false: ""
    }
  },
  defaultVariants: { pressed: false }
});
export {
  toggleButton
};
