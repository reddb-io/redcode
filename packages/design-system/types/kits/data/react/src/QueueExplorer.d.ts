import type { QueueExplorerContract } from "../../src/core/contracts/queueexplorer";
export interface QueueExplorerProps extends QueueExplorerContract {
    /** Extra root classes. */
    className?: string;
}
export declare function QueueExplorer({ label, messages, events, commands, context, error, onenqueue, className, }: QueueExplorerProps): import("react").JSX.Element;
export default QueueExplorer;
