import { type DialogProps } from "./Dialog";
import { type DrawerSide } from "../../src/drawer.variants";
export interface DrawerProps extends DialogProps {
    /** Edge that owns the Drawer. */
    side?: DrawerSide;
    /** Extra classes merged onto the edge surface. */
    className?: string;
}
export declare function Drawer(props: DrawerProps): import("react").JSX.Element;
