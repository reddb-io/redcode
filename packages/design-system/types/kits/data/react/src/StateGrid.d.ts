import type { StateGridContract } from "../../src/core/contracts/stategrid";
export type { StateCell } from "../../src/operational";
export interface StateGridProps extends StateGridContract {
    /** Additional root classes. */
    className?: string;
}
export declare function StateGrid({ label, items, cellWidth, selected, interactive, onselectedchange, emptyLabel, className, }: StateGridProps): import("react").JSX.Element;
export default StateGrid;
