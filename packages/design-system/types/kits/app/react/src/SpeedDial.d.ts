import type { ReactNode } from "react";
import type { SpeedDialContract } from "../../src/core/contracts/speeddial";
export interface SpeedDialProps extends SpeedDialContract {
    /** Reports the actions surface's open state. */
    onOpenChange?: (open: boolean) => void;
    /** Custom trigger content inside the named Button. */
    trigger?: ReactNode;
    /** Additional surface classes. */
    className?: string;
}
export declare function SpeedDial(props: SpeedDialProps): import("react").JSX.Element;
