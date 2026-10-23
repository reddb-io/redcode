/** Shared owned-draft contract for the Effect and Promise plugin editors. */
export type DeepMutable<A> = A extends string | number | boolean | bigint | symbol | ((...args: never[]) => unknown)
  ? A
  : A extends ReadonlyMap<infer K, infer V>
    ? Map<DeepMutable<K>, DeepMutable<V>>
    : A extends readonly [unknown, ...unknown[]]
      ? { -readonly [K in keyof A]: DeepMutable<A[K]> }
      : A extends ReadonlyArray<infer I>
        ? DeepMutable<I>[]
        : A extends object
          ? { -readonly [K in keyof A]: DeepMutable<A[K]> }
          : A
