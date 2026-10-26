export type { GeoMapPoint, GeoMapRoute, GeoMapGeography, GeoMapGeometry, } from "../../src/geo-map";
import type { GeoMapContract } from "../../src/core/contracts/geomap";
export interface GeoMapProps extends GeoMapContract {
    /** Reports pointer, keyboard or data-list selection of a point. */
    onSelectedChange?: (id: string) => void;
    /** Extra classes on the figure. */
    className?: string;
}
export declare function GeoMap(props: GeoMapProps): import("react").JSX.Element;
export default GeoMap;
