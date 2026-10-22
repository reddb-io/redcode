import type { ComponentPropsWithRef, ReactNode } from "react";
import { type MediaObjectAlign, type MediaObjectGap } from "../../src/media-object.variants";
export interface MediaObjectProps extends Omit<ComponentPropsWithRef<"div">, "children"> {
    /** Caller-owned leading media, commonly an Avatar or image. */
    media: ReactNode;
    /** Caller-owned heading, metadata, actions, and body. */
    children: ReactNode;
    /** Cross-axis alignment of media and content. */
    align?: MediaObjectAlign;
    /** Density-owned separation between media and content. */
    gap?: MediaObjectGap;
    /** Extra classes merged onto the relationship root. */
    className?: string;
    /** Extra classes merged onto the wrapper around the `media` content, over its own. */
    mediaClass?: string;
    /** Extra classes merged onto the wrapper around `children`, over its own. */
    contentClass?: string;
}
export declare function MediaObject({ media, children, align, gap, className, mediaClass, contentClass, ...rest }: MediaObjectProps): import("react").JSX.Element;
