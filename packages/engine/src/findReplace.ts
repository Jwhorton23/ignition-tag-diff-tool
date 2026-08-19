// Bulk find-and-replace on a single tag property across a whole file
// (PLAN.md §5 — the flagship environment-migration feature: rewrite
// opcItemPath prefixes or opcServer names in one pass). Always a two-step
// call: `previewFindReplace` computes every candidate change with nothing
// applied yet (the mandatory preview table), then the caller feeds a
// (possibly user-trimmed, per-row-opt-out) subset of those changes into
// `applyFindReplace`. Works on any single TagFile — no diff required, so
// it's usable standalone on one file too.

import type { FindReplaceChange, FindReplaceOptions, JsonObject, TagFile } from './types.js';

export function previewFindReplace(file: TagFile, options: FindReplaceOptions): FindReplaceChange[] {
  if (options.find === '') return [];

  const matcher = options.regex ? buildRegexMatcher(options) : buildLiteralMatcher(options);

  const changes: FindReplaceChange[] = [];
  for (const node of file.nodes.values()) {
    const value = node.raw[options.property];
    if (typeof value !== 'string') continue;
    const after = matcher(value);
    if (after !== null) {
      changes.push({ path: node.id, property: options.property, before: value, after });
    }
  }
  return changes.sort((a, b) => a.path.localeCompare(b.path));
}

/** Applies exactly the given changes (already filtered by the caller —
 *  e.g. per-row opt-out from the preview table). Nodes not mentioned are
 *  untouched; the source `file` is never mutated. */
export function applyFindReplace(file: TagFile, changes: readonly FindReplaceChange[]): TagFile {
  if (changes.length === 0) return file;
  const nodes = new Map(file.nodes);
  for (const change of changes) {
    const node = nodes.get(change.path);
    if (!node) continue;
    const raw: JsonObject = { ...node.raw, [change.property]: change.after };
    nodes.set(change.path, { ...node, raw });
  }
  return { ...file, nodes };
}

function buildRegexMatcher(options: FindReplaceOptions): (value: string) => string | null {
  let re: RegExp;
  try {
    re = new RegExp(options.find, options.caseSensitive ? 'g' : 'gi');
  } catch (err) {
    throw new Error(`Invalid regular expression "${options.find}": ${err instanceof Error ? err.message : String(err)}`);
  }
  return (value) => {
    const after = value.replace(re, options.replace);
    return after === value ? null : after;
  };
}

function buildLiteralMatcher(options: FindReplaceOptions): (value: string) => string | null {
  const { find, replace, caseSensitive } = options;
  if (caseSensitive) {
    return (value) => (value.includes(find) ? value.split(find).join(replace) : null);
  }
  const lowerFind = find.toLowerCase();
  return (value) => {
    const lowerValue = value.toLowerCase();
    if (!lowerValue.includes(lowerFind)) return null;
    let result = '';
    let i = 0;
    while (i < value.length) {
      if (lowerValue.startsWith(lowerFind, i)) {
        result += replace;
        i += find.length;
      } else {
        result += value[i];
        i++;
      }
    }
    return result;
  };
}
