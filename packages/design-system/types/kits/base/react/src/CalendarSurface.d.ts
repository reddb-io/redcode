import { type ComponentPropsWithRef } from "react";
import { type DateValue } from "@internationalized/date";
import { type CalendarContract, type CalendarRange } from "../../src/core/calendar";
interface CalendarSurfaceProps extends CalendarContract, Omit<ComponentPropsWithRef<"div">, keyof CalendarContract | "children" | "onSelect"> {
    selection: CalendarRange;
    initialFocus?: boolean;
    range?: boolean;
    onSelect(date: DateValue): void;
    onPlaceholderChange?: (date: DateValue) => void;
}
export declare function CalendarSurface(props: CalendarSurfaceProps): import("react").JSX.Element;
export {};
