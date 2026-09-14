export * as NoBrowser from "./no-browser"

/** Forbids every browser launch (Design review, MCP OAuth, account login, plugin OAuth). Test preloads set it. */
export const VARIABLE = "REDCODE_NO_BROWSER"

/** The first of `names` set in the environment, naming why a browser must not be launched. */
export const blockedBy = (
  names: readonly string[] = [VARIABLE],
  env: Record<string, string | undefined> = process.env,
): string | undefined => names.find((name) => !!env[name])
