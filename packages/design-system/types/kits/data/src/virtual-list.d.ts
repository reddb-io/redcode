/** Fixed-height rows measured in Density control rows. No DOM or renderer. */
export declare function virtualRange(total: number, rowHeight: number, viewportHeight: number, scrollTop: number, overscan: number): {
    start: number;
    end: number;
    top: number;
};
/** Validate stable keys and Density-relative viewport configuration identically in both adapters. */
export declare function virtualKeys<T>(items: readonly T[], rowKey: (item: T) => string, rowUnits: number, visibleRows: number): string[];
