import type { CommandPaletteCommand } from "../../src/composites/command-palette.behavior";
import type { CommandPaletteContract } from "../../src/core/contracts/commandpalette";
export interface CommandPaletteProps extends CommandPaletteContract {
    /** Reports changes to the palette's open state. */
    onOpenChange?: (open: boolean) => void;
    /** Reports the command after its own action and before closing. */
    onSelect?: (command: CommandPaletteCommand) => void;
    /** Additional wrapper classes. */
    className?: string;
}
export declare function CommandPalette(props: CommandPaletteProps): import("react").JSX.Element;
