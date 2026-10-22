import type { PlaybackControlsContract } from "../../src/core/contracts/playbackcontrols";
export interface PlaybackControlsProps extends PlaybackControlsContract {
    /** Additional root classes. */
    className?: string;
}
export declare function PlaybackControls({ label, playing, position, duration, speed, onplayingchange, onpositionchange, onspeedchange, onstep, className, }: PlaybackControlsProps): import("react").JSX.Element;
