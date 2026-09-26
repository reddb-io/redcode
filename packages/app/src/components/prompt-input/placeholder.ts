type PromptPlaceholderInput = {
  mode: "normal" | "shell"
  commentCount: number
  example: string
  suggest: boolean
  t: (key: string, params?: Record<string, string>) => string
}

export function promptPlaceholder(input: PromptPlaceholderInput) {
  if (input.mode === "shell") return `Enter shell command... ${input.example}`
  if (input.commentCount > 1) return "Summarize comments…"
  if (input.commentCount === 1) return "Summarize comment…"
  if (!input.suggest) return "Ask anything..."
  return `Ask anything... "${input.example}"`
}

export function promptDesignPlaceholder(
  mode: PromptPlaceholderInput["mode"],
  placeholder: string,
  t: PromptPlaceholderInput["t"],
) {
  if (mode === "shell") return placeholder
  return t("ui.promptInput.placeholder.normal", { slash: "/", at: "@" })
}
