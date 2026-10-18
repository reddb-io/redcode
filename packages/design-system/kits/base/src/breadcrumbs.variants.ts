import { tv, type VariantProps } from "tailwind-variants";
import { typeRoleMerge } from "./type-roles";

export const breadcrumbs = tv({
  slots: {
    root: "text-caption text-foreground",
    list: "m-0 flex list-none flex-wrap items-center gap-[var(--reddb-spatial-gap-md)] ps-0",
    item: "flex items-center gap-[var(--reddb-spatial-gap-md)]",
    current: "font-medium text-foreground",
    separator: "text-ink-muted",
  },
}, typeRoleMerge);

export type BreadcrumbsVariants = VariantProps<typeof breadcrumbs>;
