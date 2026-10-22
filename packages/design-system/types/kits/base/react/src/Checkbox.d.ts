import type { ComponentPropsWithRef } from "react";
export interface CheckboxProps extends Omit<ComponentPropsWithRef<"input">, "children" | "type"> {
    /** Required visible accessible name supplied through Field. */
    label: string;
    /** Supporting text associated with the checkbox. */
    help?: string;
    /** Current validation error associated with the checkbox. */
    error?: string;
    /** Makes the requirement visible and native. */
    required?: boolean;
    /** Controlled checked state; omit for native defaultChecked and form reset. */
    checked?: boolean;
    /** Called with the user's next checked state after the native event callback. */
    onCheckedChange?: (checked: boolean) => void;
    /** Extra classes merged onto the containing Field. */
    fieldClass?: string;
}
export declare function Checkbox({ label, help, error, required, id, checked, defaultChecked, ref, className, fieldClass, onChange, onCheckedChange, ...rest }: CheckboxProps): import("react").JSX.Element;
