/** Normalize linear audio amplitudes without assuming a capture API. */
export declare function audioLevel(value: number): number;
/** Keep the most recent bounded signed samples; the caller owns their timing. */
export declare function audioWaveform(samples: readonly number[]): string;
