const TRANSPORT_NAMES: Record<string, string> = {
  "opencode-zen": "OpenCode Zen",
  openrouter: "OpenRouter",
  typesafe: "TypeSafe",
  "red-router": "RedRouter",
  "cloudflare-ai-gateway": "Cloudflare AI Gateway",
  vercel: "Vercel",
  vivgrid: "Vivgrid",
  "nano-gpt": "NanoGPT",
}

export function evaluatorTransportName(transport: string) {
  return TRANSPORT_NAMES[transport] ?? transport
}

export function evaluatorModelName(model: string) {
  return (model.split("/").at(-1) ?? model).replace(/^jev[-_ ]/i, "JEV ")
}
