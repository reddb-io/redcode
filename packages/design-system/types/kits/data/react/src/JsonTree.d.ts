export { buildJsonTree, dottedPath } from "../../src/viewer-tree";
export type { ViewerTreeNode } from "../../src/viewer-tree";
import type { JsonTreeContract } from "../../src/core/contracts/jsontree";
export interface JsonTreeProps extends JsonTreeContract {
    /** Reports the expanded paths after a node opens or closes. */
    onExpandedChange?: (expanded: readonly string[]) => void;
    /** Receives the exact dotted path stored on the newly selected node. */
    onSelectedChange?: (path: string) => void;
    /** Extra classes, merged onto the wrapper `div` around the tree. */
    className?: string;
}
export declare function JsonTree(props: JsonTreeProps): import("react").JSX.Element;
export default JsonTree;
