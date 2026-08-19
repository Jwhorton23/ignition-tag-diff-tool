// Applies a single cherry-picked property (identified by a PropDiff.key path,
// e.g. "alarms[HiHi].setpointA" or "parameters.InstanceName" or plain
// "documentation") from a source raw object onto a clone of a base raw
// object — surgically: every other property, including unknown ones,
// survives untouched (PLAN.md §4.2). Understands the same dotted/bracketed
// path format computePropDiff produces, including identity-keyed arrays
// (alarms by name, eventScripts by eventid), so a UI can feed a PropDiff.key
// straight back in without re-encoding it.

import type { JsonObject, JsonValue } from './types.js';
import { IDENTITY_ARRAY_KEYS } from './propDiff.js';

function isPlainObject(v: JsonValue | undefined): v is JsonObject {
  return v !== null && v !== undefined && typeof v === 'object' && !Array.isArray(v);
}

/** Splits a PropDiff.key into segments. A segment like "alarms[HiHi]" stays
 *  as one token (parsed further by `applySegments`); plain keys split on ".". */
function splitPath(path: string): string[] {
  return path.split('.');
}

export function applyPropertyPatch(baseRaw: JsonObject, sourceRaw: JsonObject, path: string): JsonObject {
  const result = applySegments(baseRaw, sourceRaw, splitPath(path));
  return isPlainObject(result) ? result : { ...baseRaw };
}

function applySegments(base: JsonValue | undefined, source: JsonValue | undefined, segments: string[]): JsonValue {
  const [seg, ...rest] = segments;
  if (seg === undefined) return source ?? null;

  const arrayMatch = seg.match(/^(.+)\[(.+)\]$/);
  if (arrayMatch) {
    const arrayKey = arrayMatch[1]!;
    const idValue = arrayMatch[2]!;
    const idKeyName = IDENTITY_ARRAY_KEYS[arrayKey];
    const baseObj = isPlainObject(base) ? base : {};
    const sourceObj = isPlainObject(source) ? source : {};
    const baseArr = Array.isArray(baseObj[arrayKey]) ? [...(baseObj[arrayKey] as JsonValue[])] : [];
    const sourceArr = Array.isArray(sourceObj[arrayKey]) ? (sourceObj[arrayKey] as JsonValue[]) : [];

    const findByIdentity = (arr: JsonValue[]): number =>
      idKeyName ? arr.findIndex((it) => isPlainObject(it) && String(it[idKeyName] ?? '') === idValue) : -1;

    const baseIdx = findByIdentity(baseArr);
    const sourceItem = sourceArr.find((it) => isPlainObject(it) && idKeyName && String(it[idKeyName] ?? '') === idValue);

    if (rest.length === 0) {
      // Whole array item: add / remove / replace based on whether the source has it.
      if (sourceItem === undefined) {
        if (baseIdx !== -1) baseArr.splice(baseIdx, 1);
      } else if (baseIdx === -1) {
        baseArr.push(sourceItem);
      } else {
        baseArr[baseIdx] = sourceItem;
      }
    } else if (baseIdx !== -1 && sourceItem !== undefined) {
      baseArr[baseIdx] = applySegments(baseArr[baseIdx], sourceItem, rest);
    }
    // If the array item doesn't exist on the base side and we're patching a
    // nested property within it, there's nothing sensible to patch into —
    // leave the base array as-is (an earlier "add the whole item" patch
    // handles bringing new items over).

    return { ...baseObj, [arrayKey]: baseArr };
  }

  const baseObj = isPlainObject(base) ? base : {};
  const sourceObj = isPlainObject(source) ? source : {};
  const clone: JsonObject = { ...baseObj };

  if (rest.length === 0) {
    if (seg in sourceObj) clone[seg] = sourceObj[seg];
    else delete clone[seg];
  } else {
    clone[seg] = applySegments(baseObj[seg], sourceObj[seg], rest);
  }
  return clone;
}
