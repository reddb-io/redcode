/** Parse a complete possible Gregorian date without timezone conversion. */
export declare function possibleDate(candidate: string): RegExpMatchArray | null;
export declare function possibleTime(candidate: string): RegExpMatchArray | null;
export type DateSegment = "year" | "month" | "day" | "hour" | "minute";
export declare function segmentDigits(value: string, segment: DateSegment): string;
