import type { ToolbarContract } from "../../src/core/contracts/toolbar";
export interface ToolbarProps extends ToolbarContract {
    /** Additional toolbar classes. */
    className?: string;
}
export declare function Toolbar({ label, items, orientation, size, loop, className }: ToolbarProps): import("react").JSX.Element;
