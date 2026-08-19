// Structural hashing for fast "is this subtree even different" short-circuits.
// See PLAN.md §3.2. Non-cryptographic — this is a change-detection digest,
// not a security primitive.

import type { JsonObject, JsonValue } from './types.js';

/** Keys that are structural bookkeeping, never part of the hash input,
 *  regardless of the caller's ignore-list (children are folded in separately
 *  via `computeNodeHash`'s childHashesByName argument). */
const STRUCTURAL_KEYS = new Set<string>(['tags']);

/** Default noisy properties excluded from diff/hash by default (PLAN.md §3.2).
 *  User-editable in Phase 2; this is the shipped starting point. */
export const DEFAULT_IGNORED_KEYS: readonly string[] = ['value', 'quality', 'timestamp'];

/** Deterministic JSON stringification: object keys sorted, ignored/structural
 *  keys dropped. Array order is preserved (array order is meaningful data,
 *  e.g. alarm ordering), only object key order is normalized away. */
export function stableStringify(value: JsonValue | undefined, ignoredKeys: ReadonlySet<string>): string {
  return stringifyValue(value, ignoredKeys);
}

function stringifyValue(v: JsonValue | undefined, ignored: ReadonlySet<string>): string {
  if (v === undefined) return 'undefined';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) {
    return '[' + v.map((x) => stringifyValue(x, ignored)).join(',') + ']';
  }
  const keys = Object.keys(v)
    .filter((k) => !ignored.has(k) && !STRUCTURAL_KEYS.has(k))
    .sort();
  return (
    '{' +
    keys.map((k) => JSON.stringify(k) + ':' + stringifyValue((v as JsonObject)[k], ignored)).join(',') +
    '}'
  );
}

/** FNV-1a, 32-bit, hex-encoded. Fast and collision-safe enough for tree
 *  change-detection at tens-of-thousands-of-nodes scale. */
export function fnv1a(str: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Hash of a node's OWN (ignore-list-filtered) properties only. This is the
 *  hash diff status comparisons should use — see TagNode.ownHash. */
export function computeOwnHash(raw: JsonObject, ignoredKeys: ReadonlySet<string> = new Set(DEFAULT_IGNORED_KEYS)): string {
  return fnv1a(stableStringify(raw, ignoredKeys));
}

/** Combines a node's own (ignore-list-filtered) properties with its
 *  children's hashes, keyed by child name and sorted, so that reordering
 *  children without changing their content does not change the parent hash
 *  (tag identity is path-based, not position-based — PLAN.md §3.1). */
export function computeNodeHash(
  raw: JsonObject,
  childHashesByName: ReadonlyArray<readonly [name: string, hash: string]>,
  ignoredKeys: ReadonlySet<string> = new Set(DEFAULT_IGNORED_KEYS),
): string {
  const rawPart = stableStringify(raw, ignoredKeys);
  const childPart = childHashesByName
    .slice()
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, h]) => `${name}:${h}`)
    .join(',');
  return fnv1a(rawPart + '|' + childPart);
}
