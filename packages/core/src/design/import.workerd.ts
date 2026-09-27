export async function importModule<T>(_file: string): Promise<T> {
  throw new Error("Native Design module loading is unavailable in Workers")
}
