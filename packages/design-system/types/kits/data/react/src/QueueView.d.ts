import type { QueueViewContract } from "../../src/core/contracts/queueview";
export type { QueueSlot } from "../../src/core/contracts/queueview";
export interface QueueViewProps extends QueueViewContract {
    /** Additional root classes. */
    className?: string;
}
export declare function QueueView({ label, slots, selected, interactive, onselectedchange, emptyLabel, className, }: QueueViewProps): import("react").JSX.Element;
export default QueueView;
