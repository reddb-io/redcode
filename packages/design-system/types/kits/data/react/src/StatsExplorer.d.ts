import type { StatsExplorerContract } from "../../src/core/contracts/statsexplorer";
export { formatStatsMetric, statsGaugePercent } from "../../src/stats-explorer";
export type { StatsMetric } from "../../src/stats-explorer";
export interface StatsExplorerProps extends StatsExplorerContract {
    /** Extra root classes. */
    className?: string;
}
export declare function StatsExplorer({ label, metrics, context, emptyLabel, className }: StatsExplorerProps): import("react").JSX.Element;
export default StatsExplorer;
