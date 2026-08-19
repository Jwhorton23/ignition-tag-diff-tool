// Path alignment: maps every node in a TagFile to a stable "alignment path"
// that is comparable ACROSS files even when the root/provider name differs
// (e.g. A's root is "default", B's is "devTags" — PLAN.md §3.1 point 5).
//
// Roots are paired positionally (A's 1st root <-> B's 1st root, etc.) and the
// root's own name is replaced with a fixed "R{index}" token; every other
// path segment keeps its original name. Alignment matching is
// case-insensitive (Ignition paths are case-insensitive); the DiffNode's
// displayed path/name preserve original casing (preferring A's).

import type { TagFile, TagNode } from './types.js';

export interface AlignmentIndex {
  /** node id (TagFile-local) -> alignment path, original casing preserved. */
  pathById: Map<string, string>;
  /** lowercased alignment path -> node id, for cross-file lookup. */
  idByLowerPath: Map<string, string>;
}

export function buildAlignmentIndex(file: TagFile): AlignmentIndex {
  const pathById = new Map<string, string>();
  const idByLowerPath = new Map<string, string>();

  file.rootIds.forEach((rootId, i) => {
    assign(rootId, `R${i}`, file, pathById, idByLowerPath);
  });

  return { pathById, idByLowerPath };
}

function assign(
  nodeId: string,
  alignPath: string,
  file: TagFile,
  pathById: Map<string, string>,
  idByLowerPath: Map<string, string>,
): void {
  pathById.set(nodeId, alignPath);
  idByLowerPath.set(alignPath.toLowerCase(), nodeId);

  const node = file.nodes.get(nodeId);
  if (!node) return;
  for (const childId of node.childIds) {
    const child: TagNode | undefined = file.nodes.get(childId);
    if (!child) continue;
    assign(childId, `${alignPath}/${child.name}`, file, pathById, idByLowerPath);
  }
}

export function parentAlignPath(alignPath: string): string | null {
  const idx = alignPath.lastIndexOf('/');
  return idx === -1 ? null : alignPath.slice(0, idx);
}

export function alignPathName(alignPath: string): string {
  const idx = alignPath.lastIndexOf('/');
  return idx === -1 ? alignPath : alignPath.slice(idx + 1);
}
