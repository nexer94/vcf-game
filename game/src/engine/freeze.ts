/**
 * Deep freeze for immutable state trees and snapshots handed to render/UI.
 *
 * Objects frozen by `deepFreeze` are remembered in a WeakSet, so re-freezing a new state that shares
 * most of its subtrees with the previous one only walks the newly created nodes (cheap per tick).
 * Objects that are merely shallow-frozen elsewhere are still walked, so nested data never stays mutable.
 */
const deeplyFrozen = new WeakSet<object>();

export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  const obj = value as object;
  if (deeplyFrozen.has(obj)) return value;
  deeplyFrozen.add(obj);
  // Note: Map/Set entries cannot be frozen in place – keep plain objects/arrays in state.
  for (const key of Reflect.ownKeys(obj)) deepFreeze((obj as Record<PropertyKey, unknown>)[key]);
  Object.freeze(obj);
  return value;
}
