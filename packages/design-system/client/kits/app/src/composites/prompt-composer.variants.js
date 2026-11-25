import { tv } from "tailwind-variants";
const promptComposer = tv({
  slots: {
    root: "grid min-w-0 gap-[var(--reddb-spatial-gap-sm)] rounded-lg border border-control-edge bg-background p-[var(--reddb-spatial-inset-sm)]",
    // The field grows with its text ([field-sizing:content]) up to the caller's
    // maxRows, set as an inline max-height in lines, then scrolls.
    field: "min-h-[var(--reddb-spatial-control-height-lg)] w-full resize-none border-0 bg-transparent shadow-none [field-sizing:content]",
    footer: "flex min-w-0 flex-wrap items-center gap-[var(--reddb-spatial-gap-sm)]",
    selectors: "flex min-w-0 flex-wrap items-center gap-[var(--reddb-spatial-gap-sm)]",
    send: "ms-auto shrink-0"
  }
});
export {
  promptComposer
};
