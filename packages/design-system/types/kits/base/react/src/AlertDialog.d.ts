import { type DialogProps } from "./Dialog";
export interface AlertDialogProps extends Omit<DialogProps, "actions" | "initialFocus" | "showClose"> {
    /** Visible label for the destructive confirmation action. */
    confirmLabel: string;
    /** Visible label for the safe action. */
    cancelLabel?: string;
    /** Confirm once; fulfilment closes the overlay, rejection keeps it open for retry. */
    onConfirm?: (event: MouseEvent) => void | Promise<unknown>;
    /** Extra classes merged onto the alert surface. */
    className?: string;
}
export declare function AlertDialog(props: AlertDialogProps): import("react").JSX.Element;
