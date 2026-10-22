import type { MenubarContract } from "../../src/core/contracts/menubar";
export interface MenubarProps extends MenubarContract {
    /** Reports the open menu id or an empty string when closed. */
    onValueChange?: (value: string) => void;
    /** Additional menubar classes. */
    className?: string;
}
export declare function Menubar(props: MenubarProps): import("react").JSX.Element;
