import { type VisualizationSeries } from "./visualization";
export interface GeoMapPoint {
    id: string;
    label: string;
    latitude: number;
    longitude: number;
    description?: string;
    series?: VisualizationSeries;
}
export interface GeoMapRoute {
    id: string;
    source: string;
    target: string;
    label: string;
    series?: VisualizationSeries;
}
export type GeoPosition = readonly number[];
export type GeoMapGeometry = {
    type: "Polygon";
    coordinates: readonly (readonly GeoPosition[])[];
} | {
    type: "MultiPolygon";
    coordinates: readonly (readonly (readonly GeoPosition[])[])[];
};
/** The subset of GeoJSON needed for a provider-independent land layer. */
export interface GeoMapGeography {
    type: "FeatureCollection";
    features: readonly {
        type: "Feature";
        geometry: GeoMapGeometry | null;
        properties?: unknown;
    }[];
}
export declare const MAP_WIDTH = 1000, MAP_HEIGHT = 500;
/** WGS84 equirectangular projection. This is not a distance or area calculation. */
export declare function geoPosition(longitude: number, latitude: number): [number, number];
export declare function geoLand(geography?: GeoMapGeography): string[];
export declare function geoData(points: readonly GeoMapPoint[], routes: readonly GeoMapRoute[]): {
    points: {
        position: [number, number];
        id: string;
        label: string;
        latitude: number;
        longitude: number;
        description?: string;
        series?: VisualizationSeries;
    }[];
    routes: {
        paths: string[];
        id: string;
        source: string;
        target: string;
        label: string;
        series?: VisualizationSeries;
    }[];
};
/** Retain selected labels first, then omit collisions using measured type geometry. */
export declare function geoLabelIds(points: readonly (GeoMapPoint & {
    position: readonly number[];
})[], selected: string, scale: number, glyphWidth: number, lineHeight: number): Set<string>;
