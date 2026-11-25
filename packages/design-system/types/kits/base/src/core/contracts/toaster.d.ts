import type { ToastQueue } from "../toast-queue";
import type { ToasterPosition } from "../../toaster.variants";
/** The Toaster's shared props: one region per page that shows a queue's toasts (ADR 0056). */
export interface ToasterContract {
    /** The queue whose shown toasts this region renders; create it once with `createToastQueue`. */
    queue: ToastQueue;
    /** Accessible name of the region. Defaults to Notifications. */
    label?: string;
    /** Where the region anchors in the viewport. Defaults to bottom-end. */
    position?: ToasterPosition;
    /** Accessible and visible label of each toast's dismissal control. Defaults to Dismiss. */
    dismissLabel?: string;
}
