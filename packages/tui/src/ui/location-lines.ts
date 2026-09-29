import path from "path"
import { abbreviateHome } from "../runtime"
import { Locale } from "../util/locale"

/** The Session directory, active worktree and branch remain separate even when paths are long. */
export function locationLines(input: {
  directory: string
  checkout?: string
  worktree?: string
  branch?: string
  home: string
  width: number
}) {
  const nested = input.directory.match(/^(.*?)[\\/]\.red[\\/]worktrees[\\/]([^\\/]+)/)
  const prepared = input.directory.match(/^(.*?)[\\/]\.redcode-worktrees[\\/]([^\\/]+)[\\/]([^\\/]+)/)
  const temporary =
    nested || prepared ? undefined : input.directory.match(/^(.*?[\\/]redcode-worktrees[\\/][^\\/]+[\\/][^\\/]+)/)
  const worktree =
    input.worktree && input.checkout && input.worktree !== input.checkout
      ? contains(input.checkout, input.worktree)
        ? path.relative(input.checkout, input.worktree).replaceAll("\\", "/")
        : abbreviateHome(input.worktree, input.home)
      : nested
        ? [".red", "worktrees", nested[2]].join("/")
        : prepared
          ? abbreviateHome(path.join(prepared[1], ".redcode-worktrees", prepared[2], prepared[3]), input.home)
          : temporary
            ? abbreviateHome(temporary[1], input.home)
            : undefined
  const fit = (prefix: string, text: string) =>
    prefix + Locale.truncateMiddle(text, Math.max(3, input.width - prefix.length))
  return [
    fit("", abbreviateHome(input.directory, input.home)),
    ...(worktree || input.branch ? [fit(temporary ? "⎇ tmp " : "⎇ ", worktree ?? "primary checkout")] : []),
    ...(input.branch ? [fit("⑂ ", input.branch)] : []),
  ]
}

function contains(parent: string, child: string) {
  const relative = path.relative(parent, child)
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}
