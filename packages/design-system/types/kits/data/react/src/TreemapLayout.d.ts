import type { ReactNode } from "react";
import { type HierarchyNode, type HierarchyRectangularNode } from "d3-hierarchy";
import type { TreemapNode } from "../../src/treemap";
interface TreemapLayoutProps {
    hierarchy: HierarchyNode<TreemapNode>;
    width: number;
    height: number;
    paddingInner: number;
    paddingTop: (node: HierarchyRectangularNode<TreemapNode>) => number;
    children: (layout: {
        nodes: HierarchyRectangularNode<TreemapNode>[];
    }) => ReactNode;
}
/** Identical renderer-neutral D3 tiling, padding and hierarchy semantics. */
export default function TreemapLayout({ hierarchy, width, height, paddingInner, paddingTop, children, }: TreemapLayoutProps): ReactNode;
export {};
