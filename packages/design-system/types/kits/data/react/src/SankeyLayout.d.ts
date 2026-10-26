import type { ReactNode } from "react";
import { type SankeyNodeGeometry, type SankeyLinkGeometry } from "../../src/core/sankey-layout";
import type { SankeyData, SankeyNode } from "../../src/sankey";
interface SankeyLayoutProps {
    data: SankeyData;
    width: number;
    height: number;
    nodeId: (node: SankeyNode) => string;
    nodeWidth: number;
    nodePadding: number;
    children: (flow: {
        nodes: SankeyNodeGeometry[];
        links: SankeyLinkGeometry[];
    }) => ReactNode;
}
export default function SankeyLayout({ data, width, height, nodeWidth, nodePadding, children, }: SankeyLayoutProps): ReactNode;
export {};
