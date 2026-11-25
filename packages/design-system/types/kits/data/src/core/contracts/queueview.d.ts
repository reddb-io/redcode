import type { CollectionStateContract } from "@reddb-io/design-system/base";
import type { StateCell } from "../../operational";
export interface QueueSlot {
    /** Stable slot identity. */
    id: string;
    /** Name of the position. */
    label: string;
    /** Actual occupant; omit for an empty slot. */
    item?: StateCell;
}
/** The ordered slot collection; its state follows the shared collection contract (ADR 0056). */
export interface QueueViewContract extends CollectionStateContract {
    /** Accessible name of the ordered slot collection. */
    label: string;
    /** Actual slots in queue order; the component never schedules or reorders them. */
    slots: readonly QueueSlot[];
    /** Caller-controlled selected occupant id. */
    selected?: string | null;
    /** Whether occupied slots offer selection. */
    interactive?: boolean;
    /** Reports an occupied entity id for application-owned inspection. */
    onselectedchange?: (id: string) => void;
    /** Text for an unoccupied slot. */
    emptyLabel?: string;
}
