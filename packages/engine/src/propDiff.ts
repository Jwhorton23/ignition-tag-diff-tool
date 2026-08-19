// Lazy, per-tag property diff — computed on demand when a user opens a
// modified tag in the detail pane (PLAN.md §3.2). Structural, not
// line-based: object key order never matters, and known array-of-records
// properties (alarms, eventScripts) are matched by their natural identity
// key rather than by position, so reordering an alarm doesn't manufacture a
// spurious diff.

import type { JsonObject, JsonValue, PropDiff } from './types.js';
import { DEFAULT_IGNORED_KEYS, stableStringify } from './hash.js';

const ALWAYS_EXCLUDED = new Set<string>(['tags']);
const IDENTITY_ARRAY_KEYS: Record<string, string> = { alarms: 'name', eventScripts: 'eventid' };
const SCRIPT_LEAF_NAMES = new Set<string>(['script', 'expression']);

export function computePropDiff(
  rawA: JsonObject | undefined,
  rawB: JsonObject | undefined,
  ignoredKeys: ReadonlySet<string> = new Set(DEFAULT_IGNORED_KEYS),
): PropDiff[] {
  const out: PropDiff[] = [];
  diffObject(rawA ?? {}, rawB ?? {}, '', ignoredKeys, out);
  return out;
}

function diffObject(a: JsonObject, b: JsonObject, prefix: string, ignoredKeys: ReadonlySet<string>, out: PropDiff[]): void {
  const keys = new Set<string>([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (ALWAYS_EXCLUDED.has(key)) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    const ignored = ignoredKeys.has(topLevelKey(path));
    const hasA = Object.prototype.hasOwnProperty.call(a, key);
    const hasB = Object.prototype.hasOwnProperty.call(b, key);
    const va = a[key];
    const vb = b[key];

    if (!hasA && hasB) {
      out.push(makeRow(path, 'added', undefined, vb, ignored));
      continue;
    }
    if (hasA && !hasB) {
      out.push(makeRow(path, 'removed', va, undefined, ignored));
      continue;
    }

    const identityKey = IDENTITY_ARRAY_KEYS[key];
    if (identityKey && Array.isArray(va) && Array.isArray(vb)) {
      diffIdentityArray(va, vb, identityKey, path, ignoredKeys, out);
      continue;
    }
    if (isPlainObject(va) && isPlainObject(vb)) {
      diffObject(va, vb, path, ignoredKeys, out);
      continue;
    }
    if (Array.isArray(va) && Array.isArray(vb)) {
      diffIndexedArray(va, vb, path, ignoredKeys, out);
      continue;
    }
    if (!deepEqual(va, vb)) {
      out.push(makeRow(path, 'changed', va, vb, ignored));
    }
  }
}

function diffIdentityArray(
  a: JsonValue[],
  b: JsonValue[],
  idKey: string,
  prefix: string,
  ignoredKeys: ReadonlySet<string>,
  out: PropDiff[],
): void {
  const aMap = new Map<string, JsonObject>();
  const bMap = new Map<string, JsonObject>();
  for (const item of a) if (isPlainObject(item)) aMap.set(String(item[idKey] ?? ''), item);
  for (const item of b) if (isPlainObject(item)) bMap.set(String(item[idKey] ?? ''), item);

  const ids = new Set<string>([...aMap.keys(), ...bMap.keys()]);
  for (const id of ids) {
    const path = `${prefix}[${id}]`;
    const av = aMap.get(id);
    const bv = bMap.get(id);
    if (av && bv) {
      diffObject(av, bv, path, ignoredKeys, out);
    } else if (bv) {
      out.push(makeRow(path, 'added', undefined, bv, false));
    } else if (av) {
      out.push(makeRow(path, 'removed', av, undefined, false));
    }
  }
}

function diffIndexedArray(a: JsonValue[], b: JsonValue[], prefix: string, ignoredKeys: ReadonlySet<string>, out: PropDiff[]): void {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const path = `${prefix}[${i}]`;
    if (i >= a.length) {
      out.push(makeRow(path, 'added', undefined, b[i], false));
      continue;
    }
    if (i >= b.length) {
      out.push(makeRow(path, 'removed', a[i], undefined, false));
      continue;
    }
    const av = a[i];
    const bv = b[i];
    if (isPlainObject(av) && isPlainObject(bv)) {
      diffObject(av, bv, path, ignoredKeys, out);
      continue;
    }
    if (!deepEqual(av, bv)) {
      out.push(makeRow(path, 'changed', av, bv, false));
    }
  }
}

function makeRow(
  path: string,
  status: PropDiff['status'],
  aValue: JsonValue | undefined,
  bValue: JsonValue | undefined,
  ignored: boolean,
): PropDiff {
  const lastKey = (path.split(/[.[]/).pop() ?? path).replace(']', '');
  const renderHint: PropDiff['renderHint'] = SCRIPT_LEAF_NAMES.has(lastKey)
    ? 'script'
    : isComplex(aValue) || isComplex(bValue)
      ? 'json'
      : 'scalar';

  return {
    key: path,
    status,
    ignored,
    renderHint,
    ...(aValue !== undefined ? { aValue } : {}),
    ...(bValue !== undefined ? { bValue } : {}),
  };
}

function topLevelKey(path: string): string {
  return path.split(/[.[]/)[0] ?? path;
}

function isPlainObject(v: JsonValue | undefined): v is JsonObject {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function isComplex(v: JsonValue | undefined): boolean {
  return v !== undefined && v !== null && typeof v === 'object';
}

function deepEqual(a: JsonValue | undefined, b: JsonValue | undefined): boolean {
  const noIgnore = new Set<string>();
  return stableStringify(a, noIgnore) === stableStringify(b, noIgnore);
}
