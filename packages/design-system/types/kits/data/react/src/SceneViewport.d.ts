import { type ReactNode } from "react";
import type { SceneViewportContract } from "../../src/core/contracts/sceneviewport";
export type { SceneBounds, SceneEngine, SceneEngineContext, SceneEngineFactory, } from "../../src/scene-viewport";
export type { SceneAnnotation } from "../../src/scene-annotations";
export interface SceneViewportProps extends SceneViewportContract {
    /** Accessible static content, retained if a renderer is unavailable. */
    children: ReactNode;
    /** Additional root classes. */
    className?: string;
}
export declare function SceneViewport(props: SceneViewportProps): import("react").JSX.Element;
export default SceneViewport;
