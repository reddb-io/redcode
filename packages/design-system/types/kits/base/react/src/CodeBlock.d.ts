import { type ComponentPropsWithRef } from "react";
import { type CodeTokenizer } from "../../src/code-block.variants";
export interface CodeBlockProps extends Omit<ComponentPropsWithRef<"div">, "children"> {
    /** Exact source shown and copied; whitespace is never normalised. */
    code: string;
    /** Optional human-readable language label. */
    language?: string;
    /** Synchronous exact-source tokenizer, rendered on the server as well as in the browser. */
    grammar?: CodeTokenizer;
    /** Accessible and visible copy label. Defaults to `Copy code`. */
    copyLabel?: string;
    /** Label shown and announced after a successful copy. Defaults to `Copied`. */
    copiedLabel?: string;
    /** Retry label announced if clipboard access fails. Defaults to `Copy failed. Try again.`. */
    copyErrorLabel?: string;
    /** Name of the overflowing code region; defaults to `<language> code` or `Code sample`. */
    regionLabel?: string;
    /** Extra classes merged onto the code block root. */
    className?: string;
}
export declare function CodeBlock({ code, language, grammar, copyLabel, copiedLabel, copyErrorLabel, regionLabel, className, ...rest }: CodeBlockProps): import("react").JSX.Element;
export type { CodeTokenizer, CodeToken } from "../../src/code-block.variants";
