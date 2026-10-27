export function parseInvitation(value: string) {
  const url = URL.parse(value)
  if (
    !url ||
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.pathname !== "/auth/worker" ||
    !/^#[A-Za-z0-9_-]{43}$/.test(url.hash)
  )
    throw new Error("Expected a Redcode worker invitation link from the coordinator")
  return { coordinator: url.origin, code: url.hash.slice(1) }
}
