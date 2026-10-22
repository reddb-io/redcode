import type { ToggleGroupOption } from "../toggle-group.variants";
export interface ToggleGroupContract {
    /** Visible group name, rendered as the native legend. */
    legend: string;
    /** Caller-owned choices; exactly one enabled option is pressed when available. */
    options: readonly ToggleGroupOption[];
    /** Selected option; an absent or unavailable value resolves to the first enabled option. */
    value?: string;
    /** Initial uncontrolled value, restored by native form reset. */
    defaultValue?: string;
    /** Optional native form name for the selected value. */
    name?: string;
    /** Disables the whole group, so no option can be chosen. */
    disabled?: boolean;
    /** Supporting text announced with every option. */
    help?: string;
    /** Current validation error, announced with every option. */
    error?: string;
    /** Extra classes merged onto the segmented row. */
    listClass?: string;
    /** Extra classes merged onto each option's ToggleButton. */
    optionClass?: string;
}
export declare function toggleGroupValue(options: readonly ToggleGroupOption[], value?: string): string;
/** Roving selection skips disabled options, wraps, and respects inline direction. */
export declare function toggleGroupTarget(options: readonly ToggleGroupOption[], current: number, key: string, rtl?: boolean): number | undefined;
