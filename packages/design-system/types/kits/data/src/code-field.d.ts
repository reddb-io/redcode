/** Pure token and completion contracts for the dependency-free Data Kit CodeField. */
export interface CodeFieldToken {
    /** Grammar-owned token kind. `text` is reserved for unparsed source spans. */
    kind: string;
    /** Exact source text represented by this token. */
    value: string;
    start: number;
    end: number;
    /** Optional semantic name exposed by the grammar. */
    name?: string;
    /** Optional grammar-owned state used by the highlight layer. */
    state?: string;
}
export interface CodeFieldCompletion {
    query: string;
    replaceStart: number;
    replaceEnd: number;
}
export interface CodeFieldCompletionResult {
    value: string;
    cursor: number;
}
export interface CodeFieldGrammar {
    tokenize(value: string): readonly CodeFieldToken[];
    completionAt?(value: string, cursor: number): CodeFieldCompletion | null;
    complete?(value: string, completion: CodeFieldCompletion, suggestion: string): CodeFieldCompletionResult;
}
export interface CodeFieldSuggestion {
    value: string;
    label?: string;
    disabled?: boolean;
}
export type VariableResolver = (name: string) => boolean;
export type VariableResolution = readonly string[] | ReadonlySet<string> | VariableResolver;
/**
 * Reference `{{variable}}` grammar.
 *
 * Resolution is caller-owned: pass known names or a predicate. Unknown names
 * remain tokens and carry the `unresolved` state instead of being discarded.
 */
export declare function variableTokenGrammar(resolved?: VariableResolution): CodeFieldGrammar;
