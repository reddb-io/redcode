import path from "path"
import { ShellSelect } from "@opencode/core/shell/select"

export async function hookCommand(directory: string, name: string, source: string) {
  const script = path.join(directory, `${name} hook.cjs`)
  await Bun.write(script, source)
  const shell = ShellSelect.resolve({ priority: "compat" })
  const args = [process.execPath, script].map((value) => {
    if (ShellSelect.ps(shell)) return `'${value.replaceAll("'", "''")}'`
    if (ShellSelect.name(shell) === "cmd") return `"${value}"`
    return `'${value.replaceAll("'", "'\"'\"'")}'`
  })
  return `${ShellSelect.ps(shell) ? "& " : ""}${args.join(" ")}`
}
