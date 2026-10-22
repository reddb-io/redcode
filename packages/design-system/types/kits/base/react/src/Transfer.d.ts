import type { TransferContract } from "../../src/core/contracts/transfer";
export interface TransferProps extends TransferContract {
}
export declare function Transfer({ fromId, toId, trigger, duration, paused, }: TransferProps): import("react").JSX.Element;
