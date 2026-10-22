import type { ComponentPropsWithRef } from "react";
import { type ControlGroupOrientation } from "../../src/control-group.variants";
export interface ControlGroupProps extends Omit<ComponentPropsWithRef<"div">, "role"> {
    /** Accessible name for the related controls. */
    label: string;
    /** Visual flow without changing keyboard order. */
    orientation?: ControlGroupOrientation;
}
export declare function ControlGroup({ label, orientation, className, ...rest }: ControlGroupProps): import("react").JSX.Element;
