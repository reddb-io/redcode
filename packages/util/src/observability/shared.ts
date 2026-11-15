import { uuid } from "../uuid.js"

// Lazy: workerd forbids generating random values in global scope, so the id
// materializes on first call (inside a handler) and stays stable afterwards.
let generated: string | undefined

export function runID(): string {
  generated ??= uuid().slice(0, 8)
  return generated
}
