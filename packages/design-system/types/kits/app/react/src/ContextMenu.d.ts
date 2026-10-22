import { type ReactNode } from "react";
import type { ContextMenuContract } from "../../src/core/contracts/contextmenu";
export interface ContextMenuProps extends ContextMenuContract {
    /** Reports opening and dismissal requests. */
    onOpenChange?: (open: boolean) => void;
    /** Custom named trigger content. */
    children?: ReactNode;
    /** Additional menu surface classes. */
    className?: string;
}
export declare function ContextMenu(props: ContextMenuProps): import("react").JSX.Element;
