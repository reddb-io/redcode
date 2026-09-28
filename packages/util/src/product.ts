declare const OPENCODE_ARTIFACT: string | undefined

export const redcode = typeof OPENCODE_ARTIFACT === "string" && OPENCODE_ARTIFACT === "redcode"
export const name = redcode ? "Redcode" : "OpenCode"
export const short = redcode ? "RC" : "OC"
