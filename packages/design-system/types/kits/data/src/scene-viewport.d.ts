import { type PanZoomView } from "./pan-zoom";
/** Logical drawing bounds for an application-requested camera focus. */
export interface SceneBounds {
    x: number;
    y: number;
    width: number;
    height: number;
}
/** Optional renderer stays outside the default graph and owns its cleanup. */
export interface SceneEngine {
    update(data: unknown): void;
    pause(paused: boolean): void;
    destroy(): void;
}
export interface SceneEngineContext {
    label: string;
    data: unknown;
    signal: AbortSignal;
}
export type SceneEngineFactory = (host: HTMLElement, context: SceneEngineContext) => SceneEngine | Promise<SceneEngine>;
export declare function focusView(target: SceneBounds, viewport: {
    width: number;
    height: number;
}): PanZoomView;
/** Camera state is structural: unrelated parent renders cannot reset a paused view. */
export declare function mountSceneCamera(host: HTMLElement, changed: (view: PanZoomView) => void): {
    update(overview: SceneBounds, follow: SceneBounds | null | undefined, following: boolean, reducedMotion: boolean): "unavailable" | "reduced-motion" | undefined;
    destroy(): void;
};
/** Late async handles are disposed; no engine is imported by this module. */
export declare function mountSceneEngine(host: HTMLElement, factory: SceneEngineFactory, label: string, initial: unknown, status: (error: string | null) => void): {
    update(next: unknown): void;
    destroy(): void;
};
