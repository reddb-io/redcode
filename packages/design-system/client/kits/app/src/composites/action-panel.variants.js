import { tv } from "tailwind-variants";
const actionPanel = tv({
  slots: {
    root: "w-full",
    heading: "items-start pb-0",
    content: "flex flex-col gap-[var(--reddb-spatial-gap-md)]",
    actions: "flex w-full flex-wrap items-center justify-end gap-[var(--reddb-spatial-gap-md)]"
  }
});
export {
  actionPanel
};
