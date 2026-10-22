import { type VariantProps } from "tailwind-variants";
export declare const DRAWER_SIDES: readonly ["top", "right", "bottom", "left"];
export type DrawerSide = (typeof DRAWER_SIDES)[number];
/** Dialog appearance specialized into an edge-anchored surface. */
export declare const drawer: import("tailwind-variants").TVReturnType<{
    side: Record<"bottom" | "left" | "right" | "top", string>;
}, undefined, string, {
    side: Record<"bottom" | "left" | "right" | "top", string>;
}, undefined, import("tailwind-variants").TVReturnType<{
    side: Record<"bottom" | "left" | "right" | "top", string>;
}, undefined, string, unknown, unknown, undefined>>;
export type DrawerVariants = VariantProps<typeof drawer>;
