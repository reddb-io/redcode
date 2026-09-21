import whichPkg from "which"

/** Find a command only on the supplied system path, without loading Redcode's global directories. */
export function whichSystem(cmd: string, env: NodeJS.ProcessEnv = process.env) {
  const result = whichPkg.sync(cmd, {
    nothrow: true,
    path: env.PATH ?? env.Path ?? "",
    pathExt: env.PATHEXT ?? env.PathExt,
  })
  return typeof result === "string" ? result : null
}
