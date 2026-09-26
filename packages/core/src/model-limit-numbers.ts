/**
 * The numbers a context-overflow response carries. When output counts against the limit,
 * the accepted input is `limit - output`.
 */
export type ContextOverflowNumbers = {
  readonly limit?: number
  readonly counted?: number
  readonly output?: number
  readonly includesOutput?: boolean
}

/**
 * A token count: plain digits, or digits in groups of three behind a thousands separator, which
 * some gateways localise (`131,072`, `131.072`, `131 072`). `131.07` is not a count.
 */
const N = String.raw`(\d{1,3}(?:[.,_ ]\d{3})+|\d+)`
const number = (raw: string | undefined) => {
  if (raw === undefined) return undefined
  const value = Number(raw.replace(/[.,_ ]/g, ""))
  return Number.isFinite(value) && value > 0 ? value : undefined
}

type Shape = {
  readonly pattern: RegExp
  readonly read: (match: RegExpMatchArray) => ContextOverflowNumbers
}

const shapes: readonly Shape[] = [
  // Together, Fireworks, Novita and the routers in front of them.
  {
    pattern: new RegExp(String.raw`input length ${N} exceeds the maximum allowed input length of ${N} tokens?`, "i"),
    read: (m) => ({ counted: number(m[1]), limit: number(m[2]) }),
  },
  // Anthropic.
  {
    pattern: new RegExp(String.raw`prompt is too long:?\s*${N} tokens? > ${N} maximum`, "i"),
    read: (m) => ({ counted: number(m[1]), limit: number(m[2]) }),
  },
  // OpenAI and compatible servers, with the breakdown between messages and completion.
  {
    pattern: new RegExp(
      String.raw`maximum context length is ${N} tokens\b.*?(?:requested|resulted in) ${N} tokens\b.*?\(${N} (?:in|from) (?:the |your )?(?:input )?messages,? (?:and )?${N} (?:in|for) the completion\)`,
      "is",
    ),
    read: (m) => ({ limit: number(m[1]), counted: number(m[3]), output: number(m[4]), includesOutput: true }),
  },
  // The same without the breakdown: the count covers the completion the request asked for.
  {
    pattern: new RegExp(
      String.raw`maximum context length is ${N} tokens\b.*?(?:requested|resulted in)(?: a total of)? ${N} tokens`,
      "is",
    ),
    read: (m) => ({ limit: number(m[1]), counted: number(m[2]), includesOutput: true }),
  },
  // OpenRouter and OpenAI-compatible gateways that report the resolved input alone, with the
  // image expansion the provider counted in. The limit is the whole window; the count is input.
  {
    pattern: new RegExp(
      String.raw`maximum context length is ${N} tokens\b.*?resolved to ${N} input tokens`,
      "is",
    ),
    read: (m) => ({ limit: number(m[1]), counted: number(m[2]) }),
  },
  // Azure OpenAI and vLLM variants.
  {
    pattern: new RegExp(
      String.raw`maximum context length of ${N} tokens\b.*?requested a total of ${N} tokens:? ${N} tokens? (?:from|in) the input messages and ${N} tokens? for the completion`,
      "is",
    ),
    read: (m) => ({ limit: number(m[1]), counted: number(m[3]), output: number(m[4]), includesOutput: true }),
  },
  {
    pattern: new RegExp(
      String.raw`maximum context length of ${N} tokens\b.*?requested(?: a total of)? ${N} tokens`,
      "is",
    ),
    read: (m) => ({ limit: number(m[1]), counted: number(m[2]), includesOutput: true }),
  },
  // "120000 + max_tokens 8192 > 128000"; other arithmetic says nothing about a limit.
  {
    pattern: new RegExp(String.raw`${N}\s*\+\s*max_tokens\s*${N}\s*>\s*${N}`, "i"),
    read: (m) => ({ counted: number(m[1]), output: number(m[2]), limit: number(m[3]), includesOutput: true }),
  },
  // llama.cpp, LM Studio and friends.
  {
    pattern: new RegExp(
      String.raw`input \(${N} tokens?\) is longer than the model'?s context length \(${N} tokens?\)`,
      "i",
    ),
    read: (m) => ({ counted: number(m[1]), limit: number(m[2]) }),
  },
  {
    pattern: new RegExp(
      String.raw`input length \(${N}\) exceeds (?:the )?model'?s maximum context length \(${N}\)`,
      "i",
    ),
    read: (m) => ({ counted: number(m[1]), limit: number(m[2]) }),
  },
  {
    pattern: new RegExp(String.raw`prompt has ${N} tokens?, but the configured context size is ${N} tokens?`, "i"),
    read: (m) => ({ counted: number(m[1]), limit: number(m[2]) }),
  },
  // Gemini.
  {
    pattern: new RegExp(
      String.raw`input token count \(${N}\) exceeds the maximum number of tokens allowed \(${N}\)`,
      "i",
    ),
    read: (m) => ({ counted: number(m[1]), limit: number(m[2]) }),
  },
  // Messages that only say what the limit is.
  {
    pattern: new RegExp(String.raw`maximum context length of ${N} tokens?`, "i"),
    read: (m) => ({ limit: number(m[1]), includesOutput: true }),
  },
  {
    pattern: new RegExp(String.raw`maximum context length\s*\(${N}\)`, "i"),
    read: (m) => ({ limit: number(m[1]), includesOutput: true }),
  },
  {
    pattern: new RegExp(String.raw`too large for model with ${N} maximum context length`, "i"),
    read: (m) => ({ limit: number(m[1]), includesOutput: true }),
  },
  {
    pattern: new RegExp(String.raw`context length is only ${N} tokens?`, "i"),
    read: (m) => ({ limit: number(m[1]), includesOutput: true }),
  },
  // "maximum prompt length is N" and "exceeds the limit of N" classify a refusal but teach
  // nothing: the same words announce a limit on images, tools or uploads.
]

/**
 * Reads the limit and count out of a context-overflow message or response body. Routers wrap the
 * upstream message in their own envelope, so the whole text is searched, JSON escapes included.
 */
export const contextOverflowNumbers = (text: string): ContextOverflowNumbers | undefined => {
  for (const shape of shapes) {
    const match = shape.pattern.exec(text)
    if (!match) continue
    const numbers = shape.read(match)
    if (numbers.limit === undefined && numbers.counted === undefined) continue
    return numbers
  }
  return undefined
}
