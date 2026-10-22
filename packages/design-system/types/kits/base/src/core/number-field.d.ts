/** Native number constraints shared by both adapters; arithmetic stays in stepUp/stepDown. */
export declare function numberConstraints(min: number | undefined, max: number | undefined, step: number): {
    min: number | undefined;
    max: number | undefined;
    step: number;
};
