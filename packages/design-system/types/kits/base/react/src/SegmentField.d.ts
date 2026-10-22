import type { DateFieldContract } from "../../src/core/contracts/datefield";
interface SegmentFieldProps extends DateFieldContract {
    kind: "date" | "time";
    initialValue: string;
    onValueChange?: (value: string) => void;
    className?: string;
}
export declare function SegmentField({ kind, label, name, value, initialValue, onValueChange, help, error, required, disabled, id, className, segmentClass }: SegmentFieldProps): import("react").JSX.Element;
export {};
