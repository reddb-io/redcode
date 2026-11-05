import type { ComponentPropsWithRef } from "react";
export interface VoiceInputProps extends Omit<ComponentPropsWithRef<"button">, "children" | "onClick" | "aria-label" | "aria-pressed"> {
    /** Whether the application is currently recording. */
    recording: boolean;
    /** Linear input level from 0 to 1; ignored while not recording. */
    value?: number;
    /** Prevent activation while recording is unavailable. */
    disabled?: boolean;
    /** Stable accessible control name. */
    label?: string;
    /** Request a recording state change; the host owns capture and state. */
    onRecordingChange?: (recording: boolean) => void;
}
export declare function VoiceInput({ recording, value, label, onRecordingChange, disabled, ...rest }: VoiceInputProps): import("react").JSX.Element;
