import { type CommandPaletteCommand } from "../../src/composites/command-palette.behavior";
import type { CommandPaletteContract } from "../../src/core/contracts/commandpalette";
export interface CommandPaletteProps extends CommandPaletteContract {
    /** Reports every open-state request. */
    onOpenChange?: (open: boolean) => void;
    /** Reports selection after the command action. Modal presentation closes before invoking actions. */
    onSelect?: (command: CommandPaletteCommand) => void;
    /** Additional wrapper classes. */
    className?: string;
}
export declare function CommandPalette(props: CommandPaletteProps): import("react").JSX.Element;
