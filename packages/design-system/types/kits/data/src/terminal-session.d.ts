/** Computed browser materials inherited from the surrounding DS scope. */
export interface TerminalAppearance {
    background: string;
    foreground: string;
    fontFamily: string;
    fontSize: number;
    lineHeight: number;
    reducedMotion: boolean;
    palette: Record<"black" | "red" | "green" | "yellow" | "blue" | "magenta" | "cyan" | "white", string>;
}
/** Application-owned transport events; the DS never opens a connection or executes input. */
export type TerminalInteraction = {
    type: "data";
    data: string;
} | {
    type: "resize";
    columns: number;
    rows: number;
};
/** Runtime handle passed to the application after mounting; invalid after session change to null. */
export interface TerminalSessionHandle {
    write(data: string): void;
    clear(): void;
    focus(): void;
}
/** Adapter lifecycle. dispose must release engine listeners, timers and child DOM. */
export interface TerminalEngine extends TerminalSessionHandle {
    update(options: {
        label: string;
        appearance: TerminalAppearance;
        readOnly: boolean;
    }): void;
    fit(): void;
    dispose(): void;
}
/** Options for an optional terminal adapter, never business/session state. */
export interface TerminalEngineOptions {
    label: string;
    appearance: TerminalAppearance;
    readOnly: boolean;
    signal: AbortSignal;
    input(data: string): void;
    resize(columns: number, rows: number): void;
}
/** Called only in the browser when the session is requested. Import any engine and its CSS here. */
export type TerminalEngineFactory = (container: HTMLElement, options: TerminalEngineOptions) => TerminalEngine | Promise<TerminalEngine>;
/** Resolve from computed styles so the adapter does not hard-code Brand or Theme values. */
export declare function terminalAppearance(element: HTMLElement, reducedMotion: boolean): TerminalAppearance;
