import { type ComponentPropsWithRef } from "react";
export interface SliderProps extends Omit<ComponentPropsWithRef<"input">, "children" | "max" | "min" | "step" | "type" | "value" | "defaultValue"> {
    /** Required visible name supplied through Field. */
    label: string;
    /** Supporting text announced with the slider. */
    help?: string;
    /** Current validation error, announced and associated with the slider. */
    error?: string;
    /** Makes the requirement visible and native on the range input. */
    required?: boolean;
    /** Current caller-owned numeric value. */
    value?: number;
    /** Initial uncontrolled numeric value, restored by native form reset. Defaults to 0. */
    defaultValue?: number;
    /** Called with the newly chosen value. */
    onValueChange?: (value: number) => void;
    /** Lowest selectable value; defaults to 0. */
    min?: number;
    /** Highest selectable value; defaults to 100. */
    max?: number;
    /** Increment between values, or any for no snapping; defaults to 1. */
    step?: number | "any";
    /** Visible and accessible wording for the current numeric value. */
    formatValue?: (value: number) => string;
    /** Extra classes merged onto the Field root. */
    fieldClass?: string;
    /** Extra classes merged onto the live readout. */
    outputClass?: string;
}
export declare function Slider({ label, help, error, required, id, value, defaultValue, onValueChange, min, max, step, formatValue, className, fieldClass, outputClass, ref, onChange, ...rest }: SliderProps): import("react").JSX.Element;
