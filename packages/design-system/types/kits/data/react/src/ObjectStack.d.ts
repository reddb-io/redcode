import type { ObjectStackContract } from "../../src/core/contracts/objectstack";
export interface ObjectStackProps extends ObjectStackContract {
    /** Additional root classes. */
    className?: string;
}
export declare function ObjectStack({ label, count, maxVisible, series, className, }: ObjectStackProps): import("react").JSX.Element;
export default ObjectStack;
