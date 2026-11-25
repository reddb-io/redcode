import { type UsageMeterContract } from "../../src/core/contracts/usagemeter";
export interface UsageMeterProps extends UsageMeterContract {
    /** Extra classes merged over the root. */
    className?: string;
}
/** How much of a limit is used (ADR 0059): the canonical Meter, toned at the caller's thresholds, with an optional breakdown. */
export declare function UsageMeter({ label, used, limit, unit, segments, thresholds, format, className }: UsageMeterProps): import("react").JSX.Element;
