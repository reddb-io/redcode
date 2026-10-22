import { type ComponentPropsWithRef, type ReactNode } from "react";
import type { CheckoutField as PortableCheckoutField, CheckoutSection as PortableCheckoutSection } from "../../src/core/checkout-form";
import type { CheckoutFormContract } from "../../src/core/contracts/checkoutform";
type InputAttributes = ComponentPropsWithRef<"input">;
export type CheckoutField = PortableCheckoutField<InputAttributes["type"], InputAttributes["autoComplete"], InputAttributes["inputMode"]>;
export type CheckoutSection = PortableCheckoutSection<InputAttributes["type"], InputAttributes["autoComplete"], InputAttributes["inputMode"]>;
export interface CheckoutFormProps extends CheckoutFormContract, Omit<ComponentPropsWithRef<"form">, keyof CheckoutFormContract | "children"> {
    /** Caller-owned groups whose controls use native React input attributes. */
    sections?: readonly CheckoutSection[];
    /** Advanced caller-owned controls and grouped content. */
    children?: ReactNode;
    /** Replaces the default submit action. */
    actions?: ReactNode;
    /** Additional form classes. */
    className?: string;
}
export declare function CheckoutForm({ sections, children, error, submitLabel, actions, className, sectionClass, actionsClass, ...rest }: CheckoutFormProps): import("react").JSX.Element;
export {};
