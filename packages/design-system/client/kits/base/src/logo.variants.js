import { tv } from "tailwind-variants";
const INTERACTIVE = {
  /**
   * The `href` form. The ink focus outline (ADR 0023) is drawn on this
   * element — the box that already INCLUDES the clearspace — so it falls
   * outside the clearspace by construction; its 2px offset only moves it
   * further out.
   */
  true: "rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
  /** The default: the pure Mark, in a footer or as an avatar. */
  false: ""
};
const logo = tv({
  // `inline-flex` so the box is exactly the Mark plus its clearspace and no
  // line-height creeps in underneath; `shrink-0` so a flex parent cannot
  // squeeze the clearspace away, which would be the one opt-out ADR 0004 says
  // there is none of.
  base: [
    "m-[var(--reddb-spatial-gap-sm)]",
    "inline-flex shrink-0 items-center justify-center"
  ].join(" "),
  variants: { interactive: INTERACTIVE },
  defaultVariants: { interactive: false }
});
const logoMark = tv({ base: "block" });
export {
  logo,
  logoMark
};
