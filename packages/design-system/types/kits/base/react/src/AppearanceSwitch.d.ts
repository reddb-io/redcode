import { type ComponentPropsWithRef } from "react";
import { type AppearanceSwitchContract } from "../../src/core/appearance-switch";
export interface AppearanceSwitchProps extends AppearanceSwitchContract, Omit<ComponentPropsWithRef<"select">, "children" | "value" | "defaultValue" | "onChange" | "multiple"> {
    /** Extra classes merged onto the canonical Select. */
    className?: string;
    /** Reports a user selection; controlled React values apply when the caller acknowledges it. */
    onValueChange?: (value: string) => void;
}
export declare function AppearanceSwitch({ label, axis, options, value, defaultValue, root, storage, persistKey, className, onValueChange, ref, ...rest }: AppearanceSwitchProps): import("react").JSX.Element;
