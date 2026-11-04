import type { VectorExplorerContract } from "../../src/core/contracts/vectorexplorer";
export interface VectorExplorerProps extends VectorExplorerContract {
    /** Extra root classes. */
    className?: string;
}
export declare function VectorExplorer({ label, rows, context, searchResults, onsearch, className, }: VectorExplorerProps): import("react").JSX.Element;
export default VectorExplorer;
