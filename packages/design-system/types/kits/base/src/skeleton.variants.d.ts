import { type VariantProps } from "tailwind-variants";
export declare const skeleton: import("tailwind-variants").TVReturnType<{
    shape: {
        readonly text: "h-4 w-full rounded-md";
        readonly rectangle: "min-h-[var(--reddb-spatial-control-height-lg)] w-full rounded-md";
        readonly circle: "aspect-square size-12 rounded-full";
    };
}, undefined, "bg-muted motion-safe:animate-pulse motion-reduce:opacity-75", {
    shape: {
        readonly text: "h-4 w-full rounded-md";
        readonly rectangle: "min-h-[var(--reddb-spatial-control-height-lg)] w-full rounded-md";
        readonly circle: "aspect-square size-12 rounded-full";
    };
}, undefined, import("tailwind-variants").TVReturnType<{
    shape: {
        readonly text: "h-4 w-full rounded-md";
        readonly rectangle: "min-h-[var(--reddb-spatial-control-height-lg)] w-full rounded-md";
        readonly circle: "aspect-square size-12 rounded-full";
    };
}, undefined, "bg-muted motion-safe:animate-pulse motion-reduce:opacity-75", unknown, unknown, undefined>>;
export type SkeletonVariants = VariantProps<typeof skeleton>;
export type SkeletonShape = NonNullable<SkeletonVariants["shape"]>;
export declare const SKELETON_SHAPES: readonly SkeletonShape[];
