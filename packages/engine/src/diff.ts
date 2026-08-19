// Tree diff: aligns two TagFiles by path (PLAN.md §3.1), classifies each
// aligned path's status via structural-hash comparison (§3.2), and runs a
// UDT impact pass so a changed UDT definition shows up on every instance of
// that type — including through inheritance chains — without treating the
// instance's own (unchanged) overrides as "modified" (§3.3).

import type { DiffIndex, DiffNode, DiffRollup, DiffStatus, TagFile } from './types.js';
import { alignPathName, buildAlignmentIndex, parentAlignPath } from './alignment.js';
import { fnv1a } from './hash.js';

export function diffTagFiles(fileA: TagFile, fileB: TagFile): DiffIndex {
  const alignA = buildAlignmentIndex(fileA);
  const alignB = buildAlignmentIndex(fileB);

  const lowerKeys = new Set<string>([...alignA.idByLowerPath.keys(), ...alignB.idByLowerPath.keys()]);
  const byPath = new Map<string, DiffNode>();

  for (const lowerKey of lowerKeys) {
    const aId = alignA.idByLowerPath.get(lowerKey);
    const bId = alignB.idByLowerPath.get(lowerKey);
    const aNode = aId ? fileA.nodes.get(aId) : undefined;
    const bNode = bId ? fileB.nodes.get(bId) : undefined;
    if (!aNode && !bNode) continue;

    const aPath = aId ? alignA.pathById.get(aId) : undefined;
    const bPath = bId ? alignB.pathById.get(bId) : undefined;
    const displayPath = aPath ?? bPath;
    if (!displayPath) continue;
    const caseOnlyRename = !!(aPath && bPath && aPath !== bPath);

    let status: DiffStatus;
    if (aNode && !bNode) status = 'removed';
    else if (!aNode && bNode) status = 'added';
    else if (aNode!.tagType !== bNode!.tagType) status = 'type-changed';
    // Own properties only — NOT structuralHash, which folds in children and
    // would mark every ancestor of a changed leaf as "modified" too. A
    // folder whose own properties are untouched stays 'unchanged' even when
    // descendants differ; rollup counts (below) carry that information instead.
    else if (aNode!.ownHash === bNode!.ownHash) status = 'unchanged';
    else status = 'modified';

    const node: DiffNode = {
      path: displayPath,
      name: alignPathName(displayPath),
      parentPath: parentAlignPath(displayPath),
      status,
      kind: (bNode ?? aNode)!.kind,
      childPaths: [],
      rollup: { added: 0, removed: 0, modified: 0, inherited: 0 },
      ...(aId ? { aId } : {}),
      ...(bId ? { bId } : {}),
      ...(caseOnlyRename ? { caseOnlyRename: true } : {}),
    };
    byPath.set(displayPath, node);
  }

  // Wire up parent -> children, then sort each parent's children for stable
  // display order (name, case-insensitive).
  for (const node of byPath.values()) {
    if (node.parentPath) {
      byPath.get(node.parentPath)?.childPaths.push(node.path);
    }
  }
  for (const node of byPath.values()) {
    node.childPaths.sort((x, y) => alignPathName(x).localeCompare(alignPathName(y), undefined, { sensitivity: 'base' }));
  }

  const rootPaths = [...byPath.values()]
    .filter((n) => n.parentPath === null)
    .map((n) => n.path)
    .sort((x, y) => x.localeCompare(y, undefined, { sensitivity: 'base' }));

  applyUdtImpact(byPath, fileA, fileB);
  for (const rootPath of rootPaths) computeRollup(rootPath, byPath);

  return { byPath, rootPaths };
}

function computeRollup(path: string, byPath: Map<string, DiffNode>): DiffRollup {
  const node = byPath.get(path)!;
  const rollup: DiffRollup = { added: 0, removed: 0, modified: 0, inherited: 0 };

  if (node.status === 'added') rollup.added++;
  else if (node.status === 'removed') rollup.removed++;
  else if (node.status === 'modified' || node.status === 'type-changed') rollup.modified++;
  if (node.udtImpact === 'def-changed') rollup.inherited++;

  for (const childPath of node.childPaths) {
    const childRollup = computeRollup(childPath, byPath);
    rollup.added += childRollup.added;
    rollup.removed += childRollup.removed;
    rollup.modified += childRollup.modified;
    rollup.inherited += childRollup.inherited;
  }

  node.rollup = rollup;
  return rollup;
}

/** Marks 'def-changed' on every UDT instance present in both files whose
 *  resolved type (including its own inheritance chain) hashes differently
 *  between A and B. Missing-definition detection is a merge-time concern —
 *  see merge.ts's dependency pull-in check (PLAN.md §4.3). */
function applyUdtImpact(byPath: Map<string, DiffNode>, fileA: TagFile, fileB: TagFile): void {
  const effA = computeEffectiveDefHashes(fileA);
  const effB = computeEffectiveDefHashes(fileB);

  for (const node of byPath.values()) {
    if (node.kind !== 'udt-instance' || !node.aId || !node.bId) continue;
    const aNode = fileA.nodes.get(node.aId);
    const bNode = fileB.nodes.get(node.bId);
    const typeId = bNode?.typeId ?? aNode?.typeId;
    if (!typeId) continue;

    const aDefId = fileA.udtDefs.get(typeId);
    const bDefId = fileB.udtDefs.get(typeId);
    if (!aDefId || !bDefId) continue;

    const aHash = effA.get(aDefId);
    const bHash = effB.get(bDefId);
    if (aHash !== undefined && bHash !== undefined && aHash !== bHash) {
      node.udtImpact = 'def-changed';
    }
  }
}

/** Combines each UDT definition's own structural hash with its parent
 *  chain's (a UdtType's `typeId` points at the UDT it extends), so a change
 *  to a base type propagates to every derived type's effective hash. */
function computeEffectiveDefHashes(file: TagFile): Map<string, string> {
  const result = new Map<string, string>();
  const visiting = new Set<string>();

  function resolve(defId: string): string {
    const cached = result.get(defId);
    if (cached !== undefined) return cached;
    const node = file.nodes.get(defId);
    if (!node) return '';
    if (visiting.has(defId)) return node.structuralHash;
    visiting.add(defId);

    let combined = node.structuralHash;
    if (node.typeId) {
      const parentId = file.udtDefs.get(node.typeId);
      if (parentId && parentId !== defId) {
        combined = fnv1a(combined + '|' + resolve(parentId));
      }
    }
    visiting.delete(defId);
    result.set(defId, combined);
    return combined;
  }

  for (const defId of file.udtDefs.values()) resolve(defId);
  return result;
}
