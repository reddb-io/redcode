import { type ComponentPropsWithRef } from "react";
export interface RatingProps extends Omit<ComponentPropsWithRef<"fieldset">, "children" | "name"> {
    /** Required visible group name rendered as a native legend. */
    legend: string;
    /** Native name shared by every rating radio. */
    name: string;
    /** Controlled rating; zero means no option is selected. */
    value?: number;
    /** Initial uncontrolled rating, restored by native form reset. */
    defaultValue?: number;
    /** Called with the newly chosen rating. */
    onValueChange?: (value: number) => void;
    /** Number of stops, floored to at least one; non-finite values use five. */
    max?: number;
    /** Require a selection before native form submission. */
    required?: boolean;
    /** Supporting text announced with every stop. */
    help?: string;
    /** Validation error associated with every stop. */
    error?: string;
    /** Extra classes merged onto every stop label. */
    optionClass?: string;
    /** Extra classes merged onto every native radio. */
    controlClass?: string;
    /** Extra classes merged onto every star mark. */
    markClass?: string;
    /** Extra classes merged onto the live readout. */
    outputClass?: string;
}
export declare function Rating({ legend, name, value, defaultValue, onValueChange, max, required, help, error, id, className, optionClass, controlClass, markClass, outputClass, ref, ...rest }: RatingProps): import("react").JSX.Element;
