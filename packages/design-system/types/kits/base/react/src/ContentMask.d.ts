import type { ComponentPropsWithRef, ReactNode } from "react";
import { type ContentMaskShape } from "../../src/content-mask.variants";
export interface ContentMaskProps extends ComponentPropsWithRef<"div"> {
    /** Named geometry clipping caller-owned content. */
    shape: ContentMaskShape;
    /** Content retains its semantics, accessible name and interaction. */
    children: ReactNode;
}
export declare function ContentMask({ shape, style, className, ...rest }: ContentMaskProps): import("react").JSX.Element;
