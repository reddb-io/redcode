export * as OwnedPaths from "./owned-paths"

/**
 * Path roots the Redcode server answers itself, for its HttpApi endpoints and its raw routes alike. A web UI
 * served in front of the server hands every request at or under one of these roots to the server and serves
 * its app for everything else, so a route registered outside these roots is shadowed by the app's index page.
 * Keep this module free of imports: the CLI loads it on its startup path.
 */
export const roots = ["/api", "/auth", "/openapi.json", "/rpc", "/design"] as const

export function owned(pathname: string) {
  return roots.some((root) => pathname === root || pathname.startsWith(`${root}/`))
}
