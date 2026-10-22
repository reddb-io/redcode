import { type VariantProps } from "tailwind-variants";
export declare const CONTROL_GROUP_ORIENTATIONS: readonly ["horizontal", "vertical"];
export type ControlGroupOrientation = (typeof CONTROL_GROUP_ORIENTATIONS)[number];
export declare const controlGroup: import("tailwind-variants").TVReturnType<{
    orientation: {
        horizontal: string;
        vertical: string;
    };
}, undefined, "flex gap-[var(--reddb-spatial-gap-sm)]", {
    orientation: {
        horizontal: string;
        vertical: string;
    };
}, undefined, import("tailwind-variants").TVReturnType<{
    orientation: {
        horizontal: string;
        vertical: string;
    };
}, undefined, "flex gap-[var(--reddb-spatial-gap-sm)]", unknown, unknown, undefined>>;
export type ControlGroupVariants = VariantProps<typeof controlGroup>;
