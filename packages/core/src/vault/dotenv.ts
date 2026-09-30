export * as VaultDotenv from "./dotenv.js"

const LINE = /^(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_.-]{0,127})[ \t]*=(.*)$/

/**
 * The `NAME=value` lines of a `.env` file, in order, and how many other lines that are neither blank nor comments
 * it skipped, such as an empty value or a value spread over several lines. A quoted value keeps its content, a
 * double-quoted one reads `\n` as a line break, and an unquoted one ends before ` #`.
 */
export function parse(text: string) {
  const lines = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"))
  const entries = lines.flatMap((line) => {
    const match = LINE.exec(line)
    const value = match ? unquote(match[2].trim()) : ""
    return match && value ? [{ name: match[1], value }] : []
  })
  return { entries, skipped: lines.length - entries.length }
}

function unquote(text: string) {
  const quote = text[0]
  const comment = text.search(/[ \t]#/)
  if (quote !== '"' && quote !== "'") return comment < 0 ? text : text.slice(0, comment).trimEnd()
  const end = text.indexOf(quote, 1)
  if (end < 0) return ""
  const inner = text.slice(1, end)
  return quote === '"' ? inner.replaceAll("\\n", "\n") : inner
}
