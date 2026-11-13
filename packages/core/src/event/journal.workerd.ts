export * as EventJournal from "./journal.workerd.js"

export function make(): never {
  throw new Error("Durable event journal is not available in workerd")
}
