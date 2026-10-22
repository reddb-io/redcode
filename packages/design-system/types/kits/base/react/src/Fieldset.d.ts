import { type ComponentPropsWithRef, type ReactNode } from "react";
import { type FieldsetControlProps } from "../../src/core/fieldset";
export interface FieldsetProps extends Omit<ComponentPropsWithRef<"fieldset">, "children"> {
    /** Accessible name rendered in the native legend. */
    legend: string;
    /** Supporting text associated with each grouped control. */
    help?: string;
    /** Current group validation error. */
    error?: string;
    /** Extra classes merged onto the legend. */
    legendClass?: string;
    /** Render grouped controls with the shared help/error association. */
    children?: (control: FieldsetControlProps) => ReactNode;
}
export declare function Fieldset({ legend, help, error, legendClass, children, id, className, ...rest }: FieldsetProps): import("react").JSX.Element;
