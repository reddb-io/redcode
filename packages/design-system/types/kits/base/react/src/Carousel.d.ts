import { type ComponentPropsWithRef, type ReactNode } from "react";
import type { ImageAsset } from "../../src/image.variants";
export interface CarouselSlide {
    /** Visible meaning included in the slide's accessible position label. */
    label: string;
    /** Caller-owned slide content; takes precedence over image. */
    content?: ReactNode;
    /** Base Image contract for a slide without custom content. */
    image?: ImageAsset;
}
export interface CarouselViewportContext {
    slides: readonly CarouselSlide[];
    active: number;
    playing: boolean;
    firstIndex: number;
}
export interface CarouselProps extends Omit<ComponentPropsWithRef<"div">, "children" | "onChange"> {
    /** Accessible name for the carousel region. */
    label: string;
    /** Caller-owned slides in stable document order. */
    slides: readonly CarouselSlide[];
    /** Replace slide drawing; the renderer owns slide semantics and inactive exclusion. */
    viewport?: (context: CarouselViewportContext) => ReactNode;
    /** Initially selected zero-based slide index. */
    initialIndex?: number;
    /** Opt-in rotation with pause/resume controls, suspended under reduced motion. */
    autoplay?: boolean;
    /** Milliseconds between automatic selections. */
    interval?: number;
    /** Reports the selected zero-based index after user or timer selection. */
    onValueChange?: (index: number) => void;
    /** Prioritize the initial slide's image for Largest Contentful Paint. */
    priority?: boolean;
    /** Additional root classes. */
    className?: string;
    /** Additional viewport classes. */
    viewportClass?: string;
    /** Additional slide classes. */
    slideClass?: string;
    /** Additional navigation row classes. */
    controlsClass?: string;
}
export declare function Carousel({ label, slides, viewport, initialIndex, autoplay, interval, onValueChange, priority, className, viewportClass, slideClass, controlsClass, ...rest }: CarouselProps): import("react").JSX.Element;
