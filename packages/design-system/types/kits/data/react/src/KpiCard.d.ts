import { type ReactNode } from "react";
export * from "../../src/core/kpi-card";
import type { KpiCardContract } from "../../src/core/contracts/kpicard";
export interface KpiCardProps extends KpiCardContract {
    /** Optional chart content, normally a Sparkline imported by the caller. */
    sparkline?: ReactNode;
    /** Extra classes, merged over the root slot's own, onto the card's root `section`. */
    className?: string;
}
export declare function KpiCard(props: KpiCardProps): import("react").JSX.Element;
export default KpiCard;
