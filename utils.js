/**
  @typedef {object} EmplaceOperation
  @property {Function | undefined} update?
  @property {Function | undefined} insert
*/

/**
  @param {Map<string, any>} map
  @param {string} key
  @param {EmplaceOperation} operation
 */
export function emplace(map, key, operation = {}) {
  const value = map.get(key)
  map.set(
    key,
    value !== undefined
      ? operation.update?.(value, key, map) ?? value
      : operation.insert?.(key, map),
  )
}
