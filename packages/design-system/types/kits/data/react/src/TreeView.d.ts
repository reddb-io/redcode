import { type ReactNode } from "react";
import { type TreeNode, type TreeReorder } from "../../src/tree";
import type { TreeViewContract } from "../../src/core/contracts/treeview";
export { buildPathTree } from "../../src/tree";
export type { PathTreeOptions, TreeNode, TreeReorder, TreeReorderPosition, } from "../../src/tree";
export interface TreeViewProps extends TreeViewContract {
    /** Reports caller-owned expanded identities after an expansion action. */
    onExpandedChange?: (expanded: readonly string[]) => void;
    /** Reports a selected node identity. */
    onSelectedChange?: (selected: string | null) => void;
    /** Receives a committed, trimmed rename without mutating the caller's nodes. */
    onRename?: (node: TreeNode, label: string) => void;
    /** Proposes a validated caller-owned tree move. */
    onReorder?: (move: TreeReorder) => void;
    /** Caller-owned decoration before a node label. */
    leading?: (node: TreeNode) => ReactNode;
    /** Caller-owned detail after a node label. */
    trailing?: (node: TreeNode) => ReactNode;
    /** Additional root tree classes. */
    className?: string;
}
export declare function TreeView(props: TreeViewProps): import("react").JSX.Element;
export default TreeView;
