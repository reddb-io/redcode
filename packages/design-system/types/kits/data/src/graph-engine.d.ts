import { type ShapedGraphData } from "./graph";
export interface GraphEngineOptions {
    layout: "stress" | "force" | "radial";
}
export interface GraphEngineController {
    destroy(): void;
    focusNode(id: string | null): void;
    setData(data: ShapedGraphData, options?: GraphEngineOptions): void;
}
/** Create the canvas renderer. This module is reached only by Graph's on-mount import. */
export declare function mountGraphEngine(host: HTMLElement, initialData: ShapedGraphData, interact?: (kind: "node" | "edge", id: string) => void, _initialOptions?: GraphEngineOptions): GraphEngineController;
