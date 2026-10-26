import type { StatusBreakdownContract } from "../../src/core/contracts/statusbreakdown";
export type { StatusCount } from "../../src/core/status-breakdown";
export interface StatusBreakdownProps extends StatusBreakdownContract {
    /** Additional root classes. */
    className?: string;
}
export declare function StatusBreakdown({ label, items, selected, interactive, onselectedchange, emptyLabel, className, }: StatusBreakdownProps): import("react").JSX.Element;
export default StatusBreakdown;
