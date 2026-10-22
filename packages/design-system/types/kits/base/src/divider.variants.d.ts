import { type VariantProps } from "tailwind-variants";
export declare const DIVIDER_ORIENTATIONS: readonly ["horizontal", "vertical"];
export type DividerOrientation = (typeof DIVIDER_ORIENTATIONS)[number];
export declare const divider: import("tailwind-variants").TVReturnType<{
    orientation: {
        horizontal: string;
        vertical: string;
    };
}, undefined, "shrink-0 bg-muted", {
    orientation: {
        horizontal: string;
        vertical: string;
    };
}, undefined, import("tailwind-variants").TVReturnType<{
    orientation: {
        horizontal: string;
        vertical: string;
    };
}, undefined, "shrink-0 bg-muted", unknown, unknown, undefined>>;
export type DividerVariants = VariantProps<typeof divider>;
