import { type VariantProps } from "tailwind-variants";
export declare const productFeature: import("tailwind-variants").TVReturnType<{
    mediaSide: {
        start: {};
        end: {
            media: string;
        };
    };
}, {
    root: string;
    media: string;
    content: string;
    heading: string;
    body: string;
    actions: string;
}, undefined, {
    mediaSide: {
        start: {};
        end: {
            media: string;
        };
    };
}, {
    root: string;
    media: string;
    content: string;
    heading: string;
    body: string;
    actions: string;
}, import("tailwind-variants").TVReturnType<{
    mediaSide: {
        start: {};
        end: {
            media: string;
        };
    };
}, {
    root: string;
    media: string;
    content: string;
    heading: string;
    body: string;
    actions: string;
}, undefined, unknown, unknown, undefined>>;
export type ProductFeatureVariants = VariantProps<typeof productFeature>;
export type ProductFeatureMediaSide = NonNullable<ProductFeatureVariants["mediaSide"]>;
export declare const PRODUCT_FEATURE_MEDIA_SIDES: readonly ["start", "end"];
