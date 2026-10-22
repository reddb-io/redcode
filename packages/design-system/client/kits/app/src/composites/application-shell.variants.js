import { tv } from "tailwind-variants";
const applicationShell = tv({
  slots: {
    root: "flex min-h-dvh w-full flex-col bg-elevation-base-surface text-foreground",
    header: "shrink-0 border-b",
    headerContainer: "",
    main: "min-h-0 flex-1 bg-elevation-base-surface",
    mainContainer: "py-[var(--reddb-spatial-inset-lg)]",
    footer: "shrink-0 border-t border-elevation-sunken-border bg-elevation-sunken-surface shadow-elevation-sunken",
    footerContainer: "py-[var(--reddb-spatial-inset-sm)]"
  },
  variants: {
    fullWidth: {
      true: {
        // Edge-to-edge chrome owns its own geometry, as the workspace does.
        // A Navbar must not sit inside a separately padded, shadowed strip.
        header: "border-muted bg-navigation-surface",
        headerContainer: "py-0"
      },
      false: {
        header: "border-elevation-sunken-border bg-elevation-sunken-surface shadow-elevation-sunken",
        headerContainer: "py-[var(--reddb-spatial-inset-sm)]"
      }
    }
  },
  defaultVariants: { fullWidth: false }
});
export {
  applicationShell
};
