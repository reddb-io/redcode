import type { ComponentPropsWithRef } from "react";
import { type ImageAsset, type ImageFit, type ImagePosition } from "../../src/image.variants";
export type { ImageAsset, ImageSource, ImageFit, ImagePosition } from "../../src/image.variants";
export interface ImageProps extends ImageAsset, Omit<ComponentPropsWithRef<"img">, "alt" | "decoding" | "fetchPriority" | "height" | "loading" | "sizes" | "src" | "srcSet" | "style" | "width"> {
    /** Largest Contentful Paint candidate: eager loading, high fetch priority and synchronous decode. */
    priority?: boolean;
    /** Override the loading strategy priority implies. */
    loading?: "lazy" | "eager";
    /** How the image fills its reserved box. */
    fit?: ImageFit;
    /** Focal point preserved when cropping. */
    position?: ImagePosition;
}
export declare function Image({ src, alt, decorative, width, height, ratio, srcset, sizes, sources, priority, loading, fit, position, className, ...rest }: ImageProps): import("react").JSX.Element;
