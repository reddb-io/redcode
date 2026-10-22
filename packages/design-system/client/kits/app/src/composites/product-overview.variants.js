import { tv } from "tailwind-variants";
const productOverview = tv({
  slots: {
    root: "grid min-w-0 items-start gap-[var(--reddb-spatial-layout-gap-md)] grid-cols-[repeat(auto-fill,minmax(max(calc((100%_-_var(--reddb-spatial-layout-gap-md))_/_2_-_1px),min(calc(100%_-_1px),calc((var(--reddb-container-3xl)_-_100%)*9999))),1fr))]",
    media: "min-w-0 overflow-hidden rounded-lg bg-muted",
    content: "min-w-0",
    heading: "items-start pb-0",
    price: "text-lg font-medium text-foreground",
    body: "flex flex-col gap-[var(--reddb-spatial-gap-md)] text-foreground",
    actions: "flex flex-wrap items-center gap-[var(--reddb-spatial-gap-md)]"
  }
});
export {
  productOverview
};
