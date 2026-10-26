export { buildXmlTree, dottedPath } from "../../src/viewer-tree";
export type { ViewerTreeNode } from "../../src/viewer-tree";
import type { XmlTreeContract } from "../../src/core/contracts/xmltree";
export interface XmlTreeProps extends XmlTreeContract {
    /** Reports the expanded paths after a node opens or closes. */
    onExpandedChange?: (expanded: readonly string[]) => void;
    /** Receives the exact dotted path stored on the newly selected node. */
    onSelectedChange?: (path: string) => void;
    /** Extra classes, merged onto the wrapper `div` around the tree. */
    className?: string;
}
export declare function XmlTree(props: XmlTreeProps): import("react").JSX.Element;
export default XmlTree;
