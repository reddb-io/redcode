import type { Tone } from "@reddb-io/design-system/base";
/** A categorical entity. State is caller-owned; color never replaces its text. */
export interface StateCell {
    id: string;
    label: string;
    state: string;
    description?: string;
    tone?: Tone;
    disabled?: boolean;
}
/** A retained event is immutable and ordered by the caller. */
export interface LogEvent {
    id: string;
    datetime: string;
    time: string;
    message: string;
    source?: string;
    tone?: Tone;
}
export declare function uniqueEntities<T extends {
    id: string;
}>(items: readonly T[], name: string): readonly T[];
export declare function retainedEvents(events: readonly LogEvent[], limit: number, query: string): {
    discarded: number;
    events: LogEvent[];
};
/** Native follow-tail; user navigation immediately suspends automatic scrolling. */
export declare function followEvents(element: HTMLElement, onPause: () => void): {
    update(enabled: boolean): void;
    destroy(): void;
};
export declare function stateCellWidth(value: number): number;
/** Semantic ink for an explicit state; neutral inherits the surrounding role. */
export declare function operationalToneInk(tone?: Tone): string | undefined;
