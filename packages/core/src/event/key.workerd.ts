export * as EventKey from "./key.workerd.js"

export async function load(): Promise<never> {
  throw new Error("Durable event key storage is not available in workerd")
}
