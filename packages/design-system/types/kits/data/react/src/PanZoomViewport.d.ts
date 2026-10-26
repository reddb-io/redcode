import { type ReactNode } from "react";
import { type PanZoomView, type PanZoomControls } from "../../src/pan-zoom";
import type { PanZoomViewportContract } from "../../src/core/contracts/panzoomviewport";
export type { PanZoomView, PanZoomControls } from "../../src/pan-zoom";
export interface PanZoomViewportProps extends PanZoomViewportContract {
    /** Reports fit, keyboard, pointer and control changes to the view. */
    onViewChange?: (view: PanZoomView) => void;
    /** Replacement controls receiving the canonical view operations. */
    controls?: (controls: PanZoomControls) => ReactNode;
    /** Unscaled viewport content receiving the current camera transform. */
    overlay?: (view: PanZoomView) => ReactNode;
    /** Caller-owned drawing, preserving its children's native interactions. */
    children: ReactNode;
    /** Additional outer composition classes. */
    className?: string;
}
export declare function PanZoomViewport(props: PanZoomViewportProps): import("react").JSX.Element;
export default PanZoomViewport;
