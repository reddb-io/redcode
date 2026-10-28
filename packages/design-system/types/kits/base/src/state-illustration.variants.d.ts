import { type VariantProps } from "tailwind-variants";
/** Density-owned artwork bounds; the SVG's own viewBox keeps its aspect ratio. */
export declare const stateIllustration: import("tailwind-variants").TVReturnType<{
    size: {
        sm: string;
        md: string;
        lg: string;
        full: string;
    };
}, undefined, "block h-auto max-w-full shrink-0", {
    size: {
        sm: string;
        md: string;
        lg: string;
        full: string;
    };
}, undefined, import("tailwind-variants").TVReturnType<{
    size: {
        sm: string;
        md: string;
        lg: string;
        full: string;
    };
}, undefined, "block h-auto max-w-full shrink-0", unknown, unknown, undefined>>;
export type StateIllustrationSize = NonNullable<VariantProps<typeof stateIllustration>["size"]>;
export declare const STATE_ILLUSTRATION_SIZES: readonly ["sm", "md", "lg", "full"];
