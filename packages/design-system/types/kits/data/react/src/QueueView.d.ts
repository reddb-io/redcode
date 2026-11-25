import type { QueueViewContract } from "../../src/core/contracts/queueview";
export type { QueueSlot } from "../../src/core/contracts/queueview";
export interface QueueViewProps extends QueueViewContract {
    /** Called when the person retries after a failed load. */
    onretry?: () => void;
    /** Additional root classes. */
    className?: string;
}
export declare function QueueView({ label, slots, selected, interactive, onselectedchange, emptyLabel, state, errorMessage, retryLabel, loadingRows, onretry, className, }: QueueViewProps): import("react").JSX.Element;
export default QueueView;
