/** The independently selectable appearance axes established by ADRs 0003 and 0008. */
export declare const APPEARANCE_AXES: readonly ["theme", "color-scheme", "density"];
export type AppearanceAxis = (typeof APPEARANCE_AXES)[number];
/** One caller-owned value on an appearance axis. */
export interface AppearanceOption {
    value: string;
    label: string;
    disabled?: boolean;
}
/** Minimal persistence surface, injectable without depending on browser globals. */
export interface AppearanceStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}
export declare function appearanceAttribute(axis: AppearanceAxis): `data-${AppearanceAxis}`;
export declare function appearanceStorageKey(axis: AppearanceAxis): string;
/** Apply one value without touching either of the other independent axes. */
export declare function applyAppearance(root: HTMLElement, axis: AppearanceAxis, value: string): void;
