import { type RefObject } from "react";
import { type ChartLoading } from "../../src/chart-loading";
export declare function useChartRhythm(probe: RefObject<HTMLElement | null>): import("../../src/chart").ChartRhythm;
export declare function useElementBox(element: RefObject<HTMLElement | null>): {
    width: number;
    height: number;
} | undefined;
export declare function useChartLoading(figure: RefObject<HTMLElement | null>, loading: ChartLoading): boolean;
/** A native component boundary over an optional, deferred drawing module. */
export declare function useChartEngine<T>(wanted: boolean, load: () => Promise<{
    default: T;
}>): T | undefined;
