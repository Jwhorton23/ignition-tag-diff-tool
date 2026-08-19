// Tree flattening (for virtualization) and tri-state selection logic
// (PLAN.md §4.1, §6). Pure functions over a DiffIndex — no React here, so
// they're easy to reason about independent of render timing.

import type { DiffIndex, DiffStatus } from '@ignition-diff/engine';

export interface TreeRow {
  path: string;
  depth: number;
  hasChildren: boolean;
}

export function flattenTree(diffIndex: DiffIndex, expanded: ReadonlySet<string>, visiblePaths: ReadonlySet<string>): TreeRow[] {
  const rows: TreeRow[] = [];
  function walk(path: string, depth: number): void {
    if (!visiblePaths.has(path)) return;
    const node = diffIndex.byPath.get(path);
    if (!node) return;
    rows.push({ path, depth, hasChildren: node.childPaths.some((c) => visiblePaths.has(c)) });
    if (expanded.has(path)) {
      for (const child of node.childPaths) walk(child, depth + 1);
    }
  }
  for (const root of diffIndex.rootPaths) walk(root, 0);
  return rows;
}

// ---------------------------------------------------------------------------
// Search/filter (PLAN.md Phase 2 §7) — a node "matches" the current
// criteria; the tree shows every match plus its full ancestor chain (so you
// can see WHERE a match lives), matching git-difftool filtering conventions.
// The default criteria (statuses excluding 'unchanged') is also what gives
// "hide unchanged by default" and the original auto-expand-to-differences
// behavior — both fall out of the same mechanism now, rather than two.
// ---------------------------------------------------------------------------

export interface FilterCriteria {
  /** Case-insensitive substring match against name or full path. */
  searchText: string;
  statuses: ReadonlySet<DiffStatus>;
  /** '' = any. */
  tagType: string;
  dataType: string;
  hasAlarms: boolean;
  hasScripts: boolean;
}

export const DEFAULT_STATUS_FILTER: ReadonlySet<DiffStatus> = new Set<DiffStatus>(['added', 'removed', 'modified', 'type-changed']);

export const DEFAULT_FILTER_CRITERIA: FilterCriteria = {
  searchText: '',
  statuses: DEFAULT_STATUS_FILTER,
  tagType: '',
  dataType: '',
  hasAlarms: false,
  hasScripts: false,
};

export function computeFilterMatches(diffIndex: DiffIndex, criteria: FilterCriteria): Set<string> {
  const matches = new Set<string>();
  const needle = criteria.searchText.trim().toLowerCase();
  for (const node of diffIndex.byPath.values()) {
    if (!criteria.statuses.has(node.status)) continue;
    if (needle && !node.name.toLowerCase().includes(needle) && !node.path.toLowerCase().includes(needle)) continue;
    if (criteria.tagType && node.tagType !== criteria.tagType) continue;
    if (criteria.dataType && node.dataType !== criteria.dataType) continue;
    if (criteria.hasAlarms && !node.hasAlarms) continue;
    if (criteria.hasScripts && !node.hasScripts) continue;
    matches.add(node.path);
  }
  return matches;
}

/** Matches plus every ancestor up to a root, so a match is always reachable
 *  from a visible parent chain. */
export function computeVisiblePaths(diffIndex: DiffIndex, matches: ReadonlySet<string>): Set<string> {
  const visible = new Set<string>();
  for (const path of matches) {
    let current: string | null = path;
    while (current !== null && !visible.has(current)) {
      visible.add(current);
      current = diffIndex.byPath.get(current)?.parentPath ?? null;
    }
  }
  return visible;
}

/** Auto-expands every visible node that has at least one visible child, so
 *  matches are reachable without manually clicking through every folder. */
export function computeExpandedForVisible(diffIndex: DiffIndex, visiblePaths: ReadonlySet<string>): Set<string> {
  const expanded = new Set<string>();
  for (const path of visiblePaths) {
    const node = diffIndex.byPath.get(path);
    if (node?.childPaths.some((c) => visiblePaths.has(c))) {
      expanded.add(path);
    }
  }
  return expanded;
}

/** Paths within this subtree that are meaningful to select (i.e. not
 *  'unchanged' — nothing to do with an identical tag). */
export function selectableDescendants(diffIndex: DiffIndex, path: string): string[] {
  const node = diffIndex.byPath.get(path);
  if (!node) return [];
  const result: string[] = [];
  if (node.status !== 'unchanged') result.push(path);
  for (const child of node.childPaths) result.push(...selectableDescendants(diffIndex, child));
  return result;
}

/** Every descendant of a node PLUS the node itself, regardless of diff
 *  status — unlike `selectableDescendants`, this includes 'unchanged'
 *  nodes. Needed so a whole UDT definition (or any folder) can be forced
 *  into a merge as a complete unit: a UDT def's own status frequently stays
 *  'unchanged' even when some member tags differ (PLAN.md §3.2's
 *  ownHash-vs-structuralHash design), so the normal checkbox only ever
 *  reaches the differing members — never enough to reconstruct the type on
 *  a target gateway that doesn't have it at all yet. */
export function allDescendants(diffIndex: DiffIndex, path: string): string[] {
  const node = diffIndex.byPath.get(path);
  if (!node) return [];
  const result: string[] = [path];
  for (const child of node.childPaths) result.push(...allDescendants(diffIndex, child));
  return result;
}

/** True when a node has at least one 'unchanged' tag in its subtree (itself
 *  included) that the normal differing-only checkbox can never reach — the
 *  signal for whether the "include whole subtree" action is worth showing. */
export function hasForceIncludableUnchanged(diffIndex: DiffIndex, path: string): boolean {
  return allDescendants(diffIndex, path).length > selectableDescendants(diffIndex, path).length;
}

export function isWholeSubtreeSelected(diffIndex: DiffIndex, selected: ReadonlySet<string>, path: string): boolean {
  const items = allDescendants(diffIndex, path);
  return items.length > 0 && items.every((p) => selected.has(p));
}

/** Force-selects (or, when already fully selected, deselects) every node in
 *  the subtree regardless of status — the escape hatch from the normal
 *  differing-only selection model. Distinct from `toggleSelection`
 *  (the tree checkbox) rather than folded into it, so the common
 *  differing-only workflow stays exactly as it was. */
export function toggleWholeSubtree(diffIndex: DiffIndex, selected: ReadonlySet<string>, path: string): Set<string> {
  const items = allDescendants(diffIndex, path);
  const next = new Set(selected);
  const turnOn = !isWholeSubtreeSelected(diffIndex, selected, path);
  for (const item of items) {
    if (turnOn) next.add(item);
    else next.delete(item);
  }
  return next;
}

export type CheckboxState = 'checked' | 'unchecked' | 'indeterminate';

export function checkboxState(diffIndex: DiffIndex, selected: ReadonlySet<string>, path: string): CheckboxState {
  const items = selectableDescendants(diffIndex, path);
  if (items.length === 0) return 'unchecked';
  const selectedCount = items.filter((p) => selected.has(p)).length;
  if (selectedCount === 0) return 'unchecked';
  if (selectedCount === items.length) return 'checked';
  return 'indeterminate';
}

/** Toggles a node (and, for a folder, every differing descendant) on/off as
 *  a unit, returning a new Set (never mutates the one passed in). */
export function toggleSelection(diffIndex: DiffIndex, selected: ReadonlySet<string>, path: string): Set<string> {
  const items = selectableDescendants(diffIndex, path);
  const next = new Set(selected);
  const turnOn = checkboxState(diffIndex, selected, path) !== 'checked';
  for (const item of items) {
    if (turnOn) next.add(item);
    else next.delete(item);
  }
  return next;
}

/** Selected paths whose status is 'modified'/'type-changed' and have
 *  neither a whole-tag resolution nor any cherry-picked property yet —
 *  export must stay blocked until this is empty. */
export function unresolvedConflicts(
  diffIndex: DiffIndex,
  selected: ReadonlySet<string>,
  resolutions: ReadonlyMap<string, string>,
  cherryPicks: ReadonlyMap<string, ReadonlyMap<string, string>>,
): string[] {
  const result: string[] = [];
  for (const path of selected) {
    const node = diffIndex.byPath.get(path);
    if (!node) continue;
    if ((node.status === 'modified' || node.status === 'type-changed') && !resolutions.has(path) && !cherryPicks.get(path)?.size) {
      result.push(path);
    }
  }
  return result;
}

/** Distinct tagType/dataType values actually present in the tree, for
 *  populating the filter bar's dropdowns from real data rather than a
 *  hardcoded guess at what tag types this file happens to use. */
export function listDistinctValues(diffIndex: DiffIndex, field: 'tagType' | 'dataType'): string[] {
  const values = new Set<string>();
  for (const node of diffIndex.byPath.values()) {
    const v = field === 'tagType' ? node.tagType : node.dataType;
    if (v) values.add(v);
  }
  return [...values].sort((a, b) => a.localeCompare(b));
}

/** All folder paths (any node with children) — used to populate the
 *  "export scope" subtree picker. */
export function listFolderPaths(diffIndex: DiffIndex): string[] {
  const result: string[] = [];
  for (const node of diffIndex.byPath.values()) {
    if (node.childPaths.length > 0) result.push(node.path);
  }
  return result.sort((a, b) => a.localeCompare(b));
}
