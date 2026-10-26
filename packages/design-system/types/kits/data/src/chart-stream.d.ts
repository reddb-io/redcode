import type { ChartTimestamp } from "./chart";
export type { ChartTimestamp, ChartTimeRange } from "./chart";
/** A timestamped observation; financial aggregation and transport remain caller-owned. */
export interface ChartStreamPoint {
    readonly x: ChartTimestamp;
}
/** Bounded, coalesced updates shared by every native chart adapter. */
export interface ChartStreamOptions<T extends ChartStreamPoint> {
    /** Initial observations, normalized and bounded before the first subscription or SSR read. */
    initial?: readonly T[];
    /** Maximum observations retained in the receiving buffer. Defaults to 600. */
    maxPoints?: number;
    /** Optional retention age in milliseconds, relative to the newest received timestamp. */
    windowMs?: number;
    /** Minimum interval between scheduled publications, in milliseconds; defaults to 100. Zero selects explicit flush(). */
    intervalMs?: number;
}
/** Immutable published view. Pausing retains this data while the bounded receiver continues accepting updates. */
export interface ChartStreamSnapshot<T extends ChartStreamPoint> {
    readonly data: readonly T[];
    readonly paused: boolean;
    /** Monotonically increasing publication revision, including pause/resume changes. */
    readonly revision: number;
    /** Number of received observations through this publication, including replacements and expired arrivals. */
    readonly received: number;
}
/** A portable external store: Svelte store subscription and React useSyncExternalStore both consume this contract. */
export interface ChartStream<T extends ChartStreamPoint> {
    /** Insert or replace complete observations at the same timestamp; later calls win. Invalid timestamps reject a batch atomically. */
    upsert(points: T | readonly T[]): void;
    /** Replace the receiving buffer, for a new history snapshot or reconnect. A paused view stays frozen until resume. */
    reset(points: readonly T[]): void;
    /** Freeze the published view while receiving and trimming continue. */
    pause(): void;
    /** Publish the most recent bounded receiver immediately and continue scheduled updates. */
    resume(): void;
    /** Publish pending updates now; respects pause. Useful with intervalMs: 0 and a caller-owned scheduler. */
    flush(): void;
    /** Current stable snapshot, suitable for React's getSnapshot. */
    getSnapshot(): ChartStreamSnapshot<T>;
    /** Stable initial snapshot for SSR/hydration. Create an instance per request or mounted consumer. */
    getServerSnapshot(): ChartStreamSnapshot<T>;
    /** Receive the current snapshot synchronously, then coalesced publications. Last unsubscribe cancels scheduled work. */
    subscribe(listener: (snapshot: ChartStreamSnapshot<T>) => void): () => void;
    /** Read receiver counters without publishing or changing the paused view. */
    stats(): {
        readonly buffered: number;
        readonly received: number;
    };
    /** Cancel scheduled work and release subscriptions/buffer. Late writes are ignored; disposal is idempotent. */
    dispose(): void;
}
/** Timestamp upserts and bounded retention without a framework, network connection or browser-only side effects. */
export declare function createChartStream<T extends ChartStreamPoint>(options?: ChartStreamOptions<T>): ChartStream<T>;
