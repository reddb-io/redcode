/** Remote model inventories can contain thousands of entries, so endpoint caches must stay bounded. */
export const DISCOVERY_CACHE_LIMIT = 32

export function cached<K, V>(cache: Map<K, V>, key: K) {
  const value = cache.get(key)
  if (value === undefined) return undefined
  cache.delete(key)
  cache.set(key, value)
  return value
}

export function remember<K, V>(cache: Map<K, V>, key: K, value: V, limit = DISCOVERY_CACHE_LIMIT) {
  cache.delete(key)
  cache.set(key, value)
  while (cache.size > Math.max(1, limit)) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
  return value
}
