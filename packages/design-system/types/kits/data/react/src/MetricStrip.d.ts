import type { MetricStripContract } from "../../src/core/contracts/metricstrip";
export type { StripMetric } from "../../src/core/contracts/metricstrip";
export interface MetricStripProps extends MetricStripContract {
    /** Additional root classes. */
    className?: string;
}
export declare function MetricStrip({ label, items, className }: MetricStripProps): import("react").JSX.Element;
export default MetricStrip;
