import type { TreeNode } from "./tree";
export type ViewerTreeNode = TreeNode<unknown>;
/** Join one segment to a dotted path; the root is represented by `$`. */
export declare function dottedPath(parent: string, segment: string | number): string;
/** Build immutable TreeView nodes from a JSON-compatible value. */
export declare function buildJsonTree(value: unknown): readonly ViewerTreeNode[];
/** Parse XML into immutable TreeView nodes without a parser/runtime dependency. */
export declare function buildXmlTree(source: string): readonly ViewerTreeNode[];
