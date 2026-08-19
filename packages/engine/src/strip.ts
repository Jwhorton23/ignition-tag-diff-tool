// Strip/normalize on export (PLAN.md §5): a checklist of named strippers,
// composable with find/replace, applied as a final pass over a deep copy —
// never mutating the loaded file.
//
// The history-related property names are a best-effort list based on
// Ignition's documented tag history configuration, not verified against a
// real export the way the rest of this engine's assumptions have been
// (PLAN.md's running lesson: real exports have repeatedly diverged from
// assumption). If a real file shows different/additional history property
// names, extend HISTORY_KEYS — the stripper logic itself doesn't change.

import type { JsonObject, StripOptions, TagFile } from './types.js';

export const HISTORY_KEYS: readonly string[] = [
  'historyEnabled',
  'historyProvider',
  'historicalTagGroup',
  'historyMaxTime',
  'historyMaxTimeUnit',
  'historicalDeadbandStyle',
  'historicalDeadbandMode',
  'historicalDeadband',
];

export const DOCUMENTATION_KEYS: readonly string[] = ['documentation', 'tooltip'];

export function applyStrip(file: TagFile, options: StripOptions): TagFile {
  const keysToRemove = new Set<string>();
  if (options.removeHistory) for (const k of HISTORY_KEYS) keysToRemove.add(k);
  if (options.removeDocumentation) for (const k of DOCUMENTATION_KEYS) keysToRemove.add(k);

  if (keysToRemove.size === 0 && !options.removeAlarms && !options.clearValues) return file;

  const nodes = new Map(file.nodes);
  for (const [id, node] of file.nodes) {
    if (!hasAnyKey(node.raw, keysToRemove) && !(options.removeAlarms && 'alarms' in node.raw) && !(options.clearValues && 'value' in node.raw)) {
      continue;
    }
    const raw: JsonObject = { ...node.raw };
    for (const key of keysToRemove) delete raw[key];
    if (options.removeAlarms) delete raw.alarms;
    if (options.clearValues) delete raw.value;
    nodes.set(id, { ...node, raw });
  }
  return { ...file, nodes };
}

function hasAnyKey(raw: JsonObject, keys: ReadonlySet<string>): boolean {
  for (const key of keys) {
    if (key in raw) return true;
  }
  return false;
}
