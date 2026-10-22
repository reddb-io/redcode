import type { TelemetryRowContract } from "../../src/core/contracts/telemetryrow";
export interface TelemetryRowProps extends TelemetryRowContract {
    /** Additional root classes. */
    className?: string;
}
export declare function TelemetryRow({ label, value, max, stateLabel, condition, description, tone, className, }: TelemetryRowProps): import("react").JSX.Element;
