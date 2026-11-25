import type { CollectionStateContract } from "@reddb-io/design-system/base";
import type { ActivityTimelineRow } from "../../activity-timeline";
/** Compact activity tracks; their state follows the shared collection contract (ADR 0056). */
export interface ActivityTimelineContract extends CollectionStateContract {
    /** Accessible title for the timeline. */
    label: string;
    /** Activities and their child event intervals. */
    rows: readonly ActivityTimelineRow[];
    /** Optional finite, increasing time bounds. */
    domain?: readonly [number, number];
    /** Formats exact event times in the accessible list. */
    formatTime?: (value: number) => string;
    /** Visible text for the scroll control. */
    endLabel?: string;
}
