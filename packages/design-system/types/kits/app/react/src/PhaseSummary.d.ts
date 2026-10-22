import type { PhaseSummaryContract } from "../../src/core/contracts/phasesummary";
export interface PhaseSummaryProps extends PhaseSummaryContract {
    /** Additional root classes. */
    className?: string;
}
export declare function PhaseSummary({ label, gates, description, className, }: PhaseSummaryProps): import("react").JSX.Element;
