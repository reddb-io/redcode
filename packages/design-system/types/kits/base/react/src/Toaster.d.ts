import type { ToasterContract } from "../../src/core/contracts/toaster";
export interface ToasterProps extends ToasterContract {
    /** Extra classes merged over the region. */
    className?: string;
}
/** The one region where transient Notifications appear (ADR 0056), portalled into the topmost open modal or the body. */
export declare function Toaster({ queue, label, position, dismissLabel, className }: ToasterProps): import("react").ReactPortal | null;
