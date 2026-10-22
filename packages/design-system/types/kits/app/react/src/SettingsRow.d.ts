import { type ReactNode } from "react";
import type { SettingsRowContract } from "../../src/core/contracts/settingsrow";
import { type FieldControlProps } from "../../src/core/settings-row";
export interface SettingsRowProps extends SettingsRowContract {
    /** Field content receiving only its native id, requirement and description/error association. */
    children?: (control: FieldControlProps) => ReactNode;
    /** Independently named actions or controls. Their visible labels are never overwritten by the row. */
    actions?: ReactNode;
    /** Additional classes on the row's container. */
    className?: string;
}
export declare function SettingsRow({ label, description, error, required, id, children, actions, className }: SettingsRowProps): import("react").JSX.Element;
