import type { ComponentPropsWithRef } from "react";
import { type DividerOrientation } from "../../src/divider.variants";
export interface DividerProps extends Omit<ComponentPropsWithRef<"div">, "role" | "children"> {
    /** Visual and semantic orientation. */
    orientation?: DividerOrientation;
}
export declare function Divider({ orientation, className, ...rest }: DividerProps): import("react").JSX.Element;
