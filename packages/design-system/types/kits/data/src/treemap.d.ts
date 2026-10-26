import { type VisualizationItem } from "./visualization";
export interface TreemapNode extends VisualizationItem {
    value?: number;
    children?: readonly TreemapNode[];
}
export declare function treemapNodes(data: TreemapNode): TreemapNode[];
