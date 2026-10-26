import { type VisualizationItem, type VisualizationSeries } from "./visualization";
export interface RadarAxis {
    id: string;
    label: string;
    min?: number;
    max?: number;
    higherIsBetter?: boolean;
}
export interface RadarSeries extends VisualizationItem {
    values: Readonly<Record<string, number | null>>;
}
export declare function radarData(axes: readonly RadarAxis[], data: readonly RadarSeries[]): {
    series: VisualizationSeries;
    values: Readonly<Record<string, number | null>>;
    id: string;
    label: string;
    description?: string;
    href?: string;
}[];
export declare function radarPoint(index: number, count: number, fraction: number, cx: number, cy: number, radius: number): {
    x: number;
    y: number;
};
export declare function radarFraction(value: number, axis: RadarAxis): number;
