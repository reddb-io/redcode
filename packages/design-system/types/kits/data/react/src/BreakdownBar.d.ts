export * from "../../src/core/breakdown-bar";
import type { BreakdownBarContract } from "../../src/core/contracts/breakdownbar";
export interface BreakdownBarProps extends BreakdownBarContract {
    /** Called when a group is selected or cleared, for application-owned drill-down. */
    onSelectedChange?: (id: string | null) => void;
    /** Extra classes merged on the composition. */
    className?: string;
}
export declare function BreakdownBar(props: BreakdownBarProps): import("react").JSX.Element;
export default BreakdownBar;
