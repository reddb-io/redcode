import type { PanZoomView } from "./pan-zoom";
/** A constant-size HTML label anchored in logical scene coordinates. */
export interface SceneAnnotation {
    /** Stable identity shared with a list or inspector. */
    id: string;
    /** Logical anchor coordinate, before camera transform. */
    x: number;
    /** Logical anchor coordinate, before camera transform. */
    y: number;
    /** Visible and accessible identity. */
    label: string;
    /** Optional compact secondary context. */
    description?: string;
}
export declare function sceneAnnotations(items: readonly SceneAnnotation[]): readonly SceneAnnotation[];
/** Project then clamp a label to its viewport. Off-scene anchors are omitted. */
export declare function projectAnnotation(point: {
    x: number;
    y: number;
}, view: PanZoomView, box: {
    width: number;
    height: number;
}, label: {
    width: number;
    height: number;
}): {
    x: number;
    y: number;
    visible: boolean;
};
/** Shared DOM measurement keeps labels unscaled and prevents occluded focus targets. */
export declare function mountSceneAnnotations(host: HTMLElement): {
    update(next: PanZoomView): void;
    destroy(): void;
};
