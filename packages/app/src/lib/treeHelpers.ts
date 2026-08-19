// Tree flattening (for virtualization) and tri-state selection logic
// (PLAN.md §4.1, §6). Pure functions over a DiffIndex — no React here, so
// they're easy to reason about independent of render timing.

import type { DiffIndex } from '@ignition-diff/engine';

export interface TreeRow {
  path: string;
  depth: number;
  hasChildren: boolean;
}

export function flattenTree(diffIndex: DiffIndex, expanded: ReadonlySet<string>): TreeRow[] {
  const rows: TreeRow[] = [];
  function walk(path: string, depth: number): void {
    const node = diffIndex.byPath.get(path);
    if (!node) return;
    rows.push({ path, depth, hasChildren: node.childPaths.length > 0 });
    if (expanded.has(path)) {
      for (const child of node.childPaths) walk(child, depth + 1);
    }
  }
  for (const root of diffIndex.rootPaths) walk(root, 0);
  return rows;
}

function subtreeHasChanges(diffIndex: DiffIndex, path: string): boolean {
  const node = diffIndex.byPath.get(path);
  if (!node) return false;
  return node.status !== 'unchanged' || node.rollup.added + node.rollup.removed + node.rollup.modified + node.rollup.inherited > 0;
}

/** Expands every folder on the way to a difference by default; fully
 *  unchanged subtrees stay collapsed so a 50k-tag tree opens navigable
 *  instead of overwhelming. */
export function computeDefaultExpanded(diffIndex: DiffIndex): Set<string> {
  const expanded = new Set<string>();
  function walk(path: string): void {
    const node = diffIndex.byPath.get(path);
    if (!node || node.childPaths.length === 0) return;
    if (subtreeHasChanges(diffIndex, path)) {
      expanded.add(path);
      for (const child of node.childPaths) walk(child);
    }
  }
  for (const root of diffIndex.rootPaths) walk(root);
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

/** Selected paths whose status is 'modified'/'type-changed' and have no
 *  resolution yet — export must stay blocked until this is empty. */
export function unresolvedConflicts(diffIndex: DiffIndex, selected: ReadonlySet<string>, resolutions: ReadonlyMap<string, string>): string[] {
  const result: string[] = [];
  for (const path of selected) {
    const node = diffIndex.byPath.get(path);
    if (!node) continue;
    if ((node.status === 'modified' || node.status === 'type-changed') && !resolutions.has(path)) {
      result.push(path);
    }
  }
  return result;
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
