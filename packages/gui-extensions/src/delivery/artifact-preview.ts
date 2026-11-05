/** Inline local images and stylesheets without granting the preview access to the server. */
export async function isolatedArtifactHtml(
  entry: string,
  html: string,
  files: Readonly<Record<string, string>>,
  read: (name: string) => Promise<string>,
) {
  const origin = "https://artifact.invalid"
  const cache = new Map<string, Promise<string | undefined>>()
  const mime: Record<string, string> = {
    css: "text/css",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    woff: "font/woff",
    woff2: "font/woff2",
  }
  const resolve = (base: string, raw: string) => {
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(raw)) return
    try {
      const url = new URL(raw, `${origin}/${base}`)
      if (url.origin !== origin) return
      const name = decodeURIComponent(url.pathname.slice(1))
      return Object.hasOwn(files, name) ? name : undefined
    } catch {
      return
    }
  }
  const replaceAsync = async (
    value: string,
    pattern: RegExp,
    replace: (match: RegExpMatchArray) => Promise<string>,
  ) => {
    const matches = [...value.matchAll(pattern)]
    const values = await Promise.all(matches.map(replace))
    let index = 0
    return value.replace(pattern, () => values[index++])
  }
  const inline = (base: string, raw: string, allowCSS = true): Promise<string | undefined> => {
    const name = resolve(base, raw)
    if (!name) return Promise.resolve(undefined)
    const type = mime[name.split(".").at(-1)?.toLowerCase() ?? ""]
    if (!type) return Promise.resolve(undefined)
    if (type === "text/css" && !allowCSS) return Promise.resolve(undefined)
    const found = cache.get(name)
    if (found) return found
    if (cache.size >= 64) return Promise.resolve(undefined)
    const pending = read(name).then(async (content) => {
      if (type !== "text/css") return `data:${type};base64,${content}`
      const css = new TextDecoder().decode(Uint8Array.from(atob(content), (char) => char.charCodeAt(0)))
      const rewritten = await replaceAsync(css, /url\(\s*(["']?)([^)"']+)\1\s*\)/gi, async (match) => {
        const uri = await inline(name, match[2].trim(), false)
        return uri ? `url("${uri}")` : match[0]
      })
      const bytes = new TextEncoder().encode(rewritten)
      let binary = ""
      for (const byte of bytes) binary += String.fromCharCode(byte)
      return `data:text/css;base64,${btoa(binary)}`
    })
    cache.set(name, pending)
    return pending
  }
  const rewritten = await replaceAsync(html, /\b(src|href)\s*=\s*(["'])(.*?)\2/gi, async (match) => {
    const uri = await inline(entry, match[3])
    return uri ? `${match[1]}=${match[2]}${uri}${match[2]}` : match[0]
  })
  return `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline' data:; font-src data:">${rewritten}`
}
