import { tv } from "tailwind-variants";
const shoppingCart = tv({
  slots: {
    root: "w-full min-w-0",
    heading: "pb-0",
    list: "m-0 list-none p-0",
    item: "flex min-w-0 flex-wrap items-end gap-[var(--reddb-spatial-gap-md)]",
    details: "grid min-w-0 grow basis-[var(--reddb-container-3xs)] gap-[var(--reddb-spatial-gap-md)]",
    media: "min-w-0 overflow-hidden rounded-md bg-muted",
    identity: "min-w-0",
    name: "m-0 font-medium text-foreground",
    description: "m-0 text-ink-muted",
    price: "m-0 text-foreground",
    controls: "flex flex-wrap items-end gap-[var(--reddb-spatial-gap-md)]",
    itemActions: "flex flex-wrap items-center gap-[var(--reddb-spatial-gap-sm)]",
    quantity: "w-24",
    empty: "min-w-0",
    total: "flex items-center justify-between gap-[var(--reddb-spatial-gap-md)] font-medium",
    actions: "flex flex-wrap items-center justify-end gap-[var(--reddb-spatial-gap-md)]"
  }
});
export {
  shoppingCart
};
