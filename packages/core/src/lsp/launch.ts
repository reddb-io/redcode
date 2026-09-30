export * as LSPLaunch from "./launch.js"

// Node exits with ExitCode::kInvalidCommandLineArgument when NODE_OPTIONS carries a flag
// its version refuses, after printing "<argv0>: <flag> is not allowed in NODE_OPTIONS".
const INVALID_COMMAND_LINE_ARGUMENT = 9
const REJECTED_SUFFIX = " is not allowed in NODE_OPTIONS"

/** The NODE_OPTIONS flag a Node-based language server rejected at startup, if that is why it exited. */
export function rejectedNodeOption(exitCode: number | null, stderr: string | undefined) {
  if (exitCode !== INVALID_COMMAND_LINE_ARGUMENT || !stderr) return
  return stderr
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.endsWith(REJECTED_SUFFIX))
    .map((line) => line.slice(0, -REJECTED_SUFFIX.length))
    .map((line) => line.slice(line.lastIndexOf(": ") + 2))
    .find((flag) => /^--[\w-]+$/.test(flag))
}

/** Remove one flag, with or without an inline value, while keeping quoted values intact. */
export function withoutNodeOption(value: string | undefined, flag: string) {
  return (value?.match(/(?:[^\s"\\]|\\.|"(?:[^"\\]|\\.)*")+/g) ?? [])
    .filter((raw) => raw.replace(/"/g, "").replace(/\\(.)/g, "$1").split("=", 1)[0] !== flag)
    .join(" ")
}
