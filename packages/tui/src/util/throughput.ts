/**
 * What a finished reply says about the provider: how long the first chunk took to arrive, and
 * how fast the rest came. Both read off the assistant message's timestamps, so nothing is
 * measured here — a message without `first` (older data, an error before any chunk) yields
 * nothing rather than a guess.
 */
export namespace Throughput {
  export interface Message {
    readonly tokens: { readonly output: number; readonly reasoning: number }
    readonly time: { readonly created: number; readonly first?: number; readonly completed?: number }
  }

  export interface Info {
    /** Milliseconds from the request to the first streamed chunk. */
    readonly latency?: number
    /** Output plus reasoning tokens per second, from the first chunk to completion. */
    readonly speed?: number
  }

  export function of(msg: Message): Info {
    const first = msg.time.first
    if (first === undefined || first < msg.time.created) return {}
    const latency = first - msg.time.created
    const completed = msg.time.completed
    const produced = msg.tokens.output + msg.tokens.reasoning
    if (completed === undefined || completed <= first || produced <= 0) return { latency }
    return { latency, speed: produced / ((completed - first) / 1000) }
  }

  export function formatLatency(ms: number): string {
    if (ms < 1000) return `${Math.round(ms)}ms`
    return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`
  }

  export function formatSpeed(tps: number): string {
    return `${tps < 10 ? tps.toFixed(1) : Math.round(tps)} tk/s`
  }
}
