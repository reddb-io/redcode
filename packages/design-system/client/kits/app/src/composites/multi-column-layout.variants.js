import { tv } from "tailwind-variants";
const COLUMNS = {
  two: {
    start: "@3xl/multi-column-layout:grow-[1] @3xl/multi-column-layout:basis-0",
    main: "@3xl/multi-column-layout:grow-[2] @3xl/multi-column-layout:basis-0",
    end: ""
  },
  three: {
    start: "@3xl/multi-column-layout:grow-[1] @3xl/multi-column-layout:basis-0",
    main: "@3xl/multi-column-layout:grow-[2] @3xl/multi-column-layout:basis-0",
    end: "@5xl/multi-column-layout:grow-[1] @5xl/multi-column-layout:basis-0"
  }
};
const multiColumnLayout = tv({
  slots: {
    root: "@container/multi-column-layout flex w-full min-w-0 flex-wrap items-start gap-[var(--reddb-spatial-layout-gap-md)]",
    column: "min-w-0 basis-full",
    start: "",
    main: "",
    end: ""
  },
  variants: { columns: COLUMNS },
  defaultVariants: { columns: "two" }
});
export {
  multiColumnLayout
};
