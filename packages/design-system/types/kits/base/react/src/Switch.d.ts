import type { ComponentPropsWithRef } from "react";
export interface SwitchProps extends Omit<ComponentPropsWithRef<"input">, "children" | "role" | "type"> {
    /** Required visible accessible name supplied through Field. */
    label: string;
    /** Supporting text associated with the switch. */
    help?: string;
    /** Current validation error associated with the switch. */
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
export declare function Switch({ label, help, error, required, id, checked, defaultChecked, ref, className, fieldClass, onChange, onCheckedChange, ...rest }: SwitchProps): import("react").JSX.Element;
