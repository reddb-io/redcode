import type { ShortcutHelpContract } from "../../src/core/contracts/shortcuthelp";
export type { ShortcutGroup, ShortcutCommand, } from "../../src/core/shortcut-help";
export interface ShortcutHelpProps extends ShortcutHelpContract {
    /** Additional classes on the reference list. */
    className?: string;
}
export declare function ShortcutHelp(props: ShortcutHelpProps): import("react").JSX.Element;
export default ShortcutHelp;
