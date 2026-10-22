import { tv } from "tailwind-variants";
const productQuickview = tv({
  slots: {
    root: "contents",
    dialog: "text-foreground",
    content: "isolate grid min-w-0 gap-[var(--reddb-spatial-layout-gap-md)] grid-cols-[repeat(auto-fill,minmax(max(calc((100%_-_var(--reddb-spatial-layout-gap-md))_/_2_-_1px),min(calc(100%_-_1px),calc((var(--reddb-container-3xl)_-_100%)*9999))),1fr))]",
    media: "min-w-0 overflow-hidden rounded-lg bg-muted",
    body: "grid min-w-0 content-start gap-[var(--reddb-spatial-gap-md)]"
  }
});
export {
  productQuickview
};
