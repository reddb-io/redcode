import { type ComponentPropsWithRef } from "react";
import { type ToggleGroupContract } from "../../src/core/toggle-group";
export type { ToggleGroupOption } from "../../src/toggle-group.variants";
export interface ToggleGroupProps extends ToggleGroupContract, Omit<ComponentPropsWithRef<"fieldset">, "children" | "name" | "value" | "defaultValue" | "disabled"> {
    /** Extra classes merged onto the native fieldset. */
    className?: string;
    /** Called with a newly selected option; reset does not emit a user change. */
    onValueChange?: (value: string) => void;
}
export declare function ToggleGroup({ legend, options, value, defaultValue, name, disabled, help, error, className, listClass, optionClass, onValueChange, ref, ...rest }: ToggleGroupProps): import("react").JSX.Element;
