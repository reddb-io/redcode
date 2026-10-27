/** Build a connection command for the existing shell-free SSH parser. Passwords belong to askpass, never this string. */
export function connectionTarget(input: { target: string; user: string; port: string; identity: string }) {
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`
  const options = [
    ...(input.user.trim() ? ["-l", quote(input.user.trim())] : []),
    ...(input.port.trim() ? ["-p", quote(input.port.trim())] : []),
    ...(input.identity.trim() ? ["-o", "IdentitiesOnly=yes", "-i", quote(input.identity.trim())] : []),
  ]
  if (!options.length) return input.target
  return ["ssh", ...options, input.target.trim().replace(/^ssh\s+/, "")].join(" ")
}
