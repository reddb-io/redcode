import type { GraphExplorerContract } from "../../src/core/contracts/graphexplorer";
export interface GraphExplorerProps extends GraphExplorerContract {
    /** Extra root classes. */
    className?: string;
}
export declare function GraphExplorer({ label, data, context, error, emptyReason, recoveryHref, recoveryLabel, initialView, onquery, nodehref, className, }: GraphExplorerProps): import("react").JSX.Element;
export default GraphExplorer;
