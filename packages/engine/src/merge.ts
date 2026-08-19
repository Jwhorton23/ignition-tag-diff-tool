// Merge engine (PLAN.md §4): turns a user's tri-state selection + conflict
// resolutions into a reviewable MergePlan (buildMergePlan), then applies
// that plan against the two source files to produce a new, fully-formed
// TagFile ready for serialize.ts (applyMergePlan). A final dependency pass
// (findMissingUdtDefs / pullInUdtDefs) prevents the most common broken-import
// scenario: a UDT instance shipped without the definition it needs.
//
// Cherry-pick (the 'patch' op) is modeled and applied here for completeness,
// but buildMergePlan never emits it yet -- Phase 1's conflict UI only offers
// Take-A/Take-B (whole-node 'replace'); Phase 2 adds the property-level
// cherry-pick UI that will start emitting 'patch' ops.

import type {
  DiffIndex,
  DiffNode,
  JsonObject,
  MergeDirection,
  MergeOp,
  MergePlan,
  MergeSide,
  TagFile,
  TagFileMeta,
  TagNode,
} from './types.js';
import { alignPathName, buildAlignmentIndex, parentAlignPath, type AlignmentIndex } from './alignment.js';
import { classifyKind } from './parse.js';

export interface BuildMergePlanInput {
  diffIndex: DiffIndex;
  /** Diff paths the user has checked for inclusion in the merge. */
  selection: ReadonlySet<string>;
  /** Conflict resolution for 'modified'/'type-changed' paths that were selected. */
  resolutions: ReadonlyMap<string, MergeSide>;
  direction: MergeDirection;
  /** Opt-in: mirror 'removed'/'added' differences by deleting from the base
   *  when the base is the side that natively has the tag (PLAN.md §4.1). */
  mirrorDeletions: boolean;
}

export function buildMergePlan(input: BuildMergePlanInput): MergePlan {
  const { diffIndex, selection, resolutions, direction, mirrorDeletions } = input;
  const baseFile: MergeSide | null = direction === 'into-a' ? 'a' : direction === 'into-b' ? 'b' : null;
  const ops: MergeOp[] = [];

  for (const path of selection) {
    const node = diffIndex.byPath.get(path);
    if (!node) continue;

    if (direction === 'new-file') {
      const from = pickSourceSide(node, resolutions);
      if (from) ops.push({ op: 'add', path, from });
      continue;
    }

    if (node.status === 'added' || node.status === 'removed') {
      const uniqueSide: MergeSide = node.status === 'added' ? 'b' : 'a';
      if (baseFile === uniqueSide) {
        if (mirrorDeletions) ops.push({ op: 'remove', path });
      } else {
        ops.push({ op: 'add', path, from: uniqueSide });
      }
    } else if (node.status === 'modified' || node.status === 'type-changed') {
      const resolved = resolutions.get(path);
      if (resolved && resolved !== baseFile) {
        ops.push({ op: 'replace', path, from: resolved });
      }
    }
    // 'unchanged' selections are meaningless for into-a/into-b -- nothing to change.
  }

  return { direction, baseFile, ops, transforms: [] };
}

function pickSourceSide(node: DiffNode, resolutions: ReadonlyMap<string, MergeSide>): MergeSide | null {
  switch (node.status) {
    case 'added':
      return 'b';
    case 'removed':
      return 'a';
    case 'modified':
    case 'type-changed':
      return resolutions.get(node.path) ?? 'b';
    case 'unchanged':
      // NOT `node.bId ? ...` — bId can legitimately be "" (empty-string root id).
      return node.bId !== undefined ? 'b' : 'a';
    default:
      return null;
  }
}

export interface MissingUdtDef {
  instancePath: string;
  typeId: string;
}

export interface ApplyMergeResult {
  file: TagFile;
  missingUdtDefs: MissingUdtDef[];
}

export function applyMergePlan(fileA: TagFile, fileB: TagFile, plan: MergePlan): ApplyMergeResult {
  const alignA = buildAlignmentIndex(fileA);
  const alignB = buildAlignmentIndex(fileB);

  const sourceFile = (side: MergeSide): TagFile => (side === 'a' ? fileA : fileB);
  const sourceAlign = (side: MergeSide): AlignmentIndex => (side === 'a' ? alignA : alignB);
  const otherSide = (side: MergeSide): MergeSide => (side === 'a' ? 'b' : 'a');

  const working = new Map<string, JsonObject>();
  const orderHint = new Map<string, number>();

  function nodeAt(side: MergeSide, alignPath: string): TagNode | undefined {
    const id = sourceAlign(side).idByLowerPath.get(alignPath.toLowerCase());
    // NOT `id ? ... : undefined` — id can legitimately be "" (empty-string root id).
    return id !== undefined ? sourceFile(side).nodes.get(id) : undefined;
  }

  function bareRaw(node: TagNode): JsonObject {
    const raw: JsonObject = { ...node.raw };
    if ('tags' in node.raw) raw.tags = [];
    return raw;
  }

  function ensureAncestors(alignPath: string, preferredSide: MergeSide): void {
    const parent = parentAlignPath(alignPath);
    if (parent === null || working.has(parent)) return;
    ensureAncestors(parent, preferredSide);
    const real = nodeAt(preferredSide, parent) ?? nodeAt(otherSide(preferredSide), parent);
    if (real) {
      working.set(parent, bareRaw(real));
      orderHint.set(parent, real.sourceIndex);
    } else {
      working.set(parent, { name: alignPathName(parent), tagType: 'Folder', tags: [] });
      orderHint.set(parent, 0);
    }
  }

  function copySubtree(side: MergeSide, alignPath: string): void {
    const node = nodeAt(side, alignPath);
    if (!node) return;
    working.set(alignPath, bareRaw(node));
    orderHint.set(alignPath, node.sourceIndex);
    for (const childId of node.childIds) {
      const child = sourceFile(side).nodes.get(childId);
      if (!child) continue;
      copySubtree(side, `${alignPath}/${child.name}`);
    }
  }

  function removeSubtree(alignPath: string): void {
    working.delete(alignPath);
    orderHint.delete(alignPath);
    const prefix = `${alignPath}/`;
    for (const key of working.keys()) {
      if (key.startsWith(prefix)) {
        working.delete(key);
        orderHint.delete(key);
      }
    }
  }

  // Seed with the base file's full tree so untouched nodes stay byte-identical.
  if (plan.baseFile) {
    const base = sourceFile(plan.baseFile);
    const baseAlign = sourceAlign(plan.baseFile);
    for (const [nodeId, alignPath] of baseAlign.pathById) {
      const node = base.nodes.get(nodeId)!;
      working.set(alignPath, bareRaw(node));
      orderHint.set(alignPath, node.sourceIndex);
    }
  }

  for (const op of plan.ops) {
    if (op.op === 'add' || op.op === 'replace') {
      ensureAncestors(op.path, op.from);
      if (op.op === 'replace') removeSubtree(op.path);
      copySubtree(op.from, op.path);
    } else if (op.op === 'remove') {
      removeSubtree(op.path);
    } else if (op.op === 'patch') {
      const existing = working.get(op.path);
      if (existing) {
        const clone: JsonObject = { ...existing };
        for (const { key, from } of op.props) {
          const srcNode = nodeAt(from, op.path);
          if (srcNode && key in srcNode.raw) clone[key] = srcNode.raw[key];
        }
        working.set(op.path, clone);
      }
    }
  }

  // Group by parent and assign fresh, contiguous sibling ordering.
  const childrenByParent = new Map<string, string[]>();
  const rootPathsUnsorted: string[] = [];
  for (const alignPath of working.keys()) {
    const parent = parentAlignPath(alignPath);
    if (parent === null) {
      rootPathsUnsorted.push(alignPath);
    } else {
      if (!childrenByParent.has(parent)) childrenByParent.set(parent, []);
      childrenByParent.get(parent)!.push(alignPath);
    }
  }

  function assignOrder(paths: string[]): string[] {
    const sorted = paths
      .slice()
      .sort((x, y) => (orderHint.get(x) ?? 0) - (orderHint.get(y) ?? 0) || alignPathName(x).localeCompare(alignPathName(y)));
    sorted.forEach((p, i) => orderHint.set(p, i));
    return sorted;
  }

  const rootPaths = assignOrder(rootPathsUnsorted);
  const sortedChildrenByParent = new Map<string, string[]>();
  for (const [parent, children] of childrenByParent) {
    sortedChildrenByParent.set(parent, assignOrder(children));
  }

  const nodes = new Map<string, TagNode>();
  for (const [alignPath, raw] of working) {
    const name = typeof raw.name === 'string' ? raw.name : alignPathName(alignPath);
    const tagType = typeof raw.tagType === 'string' ? raw.tagType : undefined;
    const typeId = typeof raw.typeId === 'string' ? raw.typeId : undefined;
    nodes.set(alignPath, {
      id: alignPath,
      name,
      kind: classifyKind(tagType),
      ...(tagType !== undefined ? { tagType } : {}),
      ...(typeId !== undefined ? { typeId } : {}),
      raw,
      childIds: sortedChildrenByParent.get(alignPath) ?? [],
      // Hashes are diff-time concerns; the merge result is a terminal
      // output (serialized and handed to the user), never re-diffed.
      ownHash: '',
      structuralHash: '',
      sourceIndex: orderHint.get(alignPath) ?? 0,
      parentId: parentAlignPath(alignPath),
    });
  }

  const udtDefs = new Map<string, string>();
  for (const [alignPath, node] of nodes) {
    if (node.kind === 'udt-def' && !udtDefs.has(node.name)) udtDefs.set(node.name, alignPath);
  }

  const missingUdtDefs: MissingUdtDef[] = [];
  for (const [alignPath, node] of nodes) {
    if (node.kind === 'udt-instance' && node.typeId && !udtDefs.has(node.typeId)) {
      missingUdtDefs.push({ instancePath: alignPath, typeId: node.typeId });
    }
  }

  const meta: TagFileMeta = plan.baseFile
    ? { ...sourceFile(plan.baseFile).meta, rootShape: deriveRootShape(rootPaths, nodes) }
    : { detectedVersionHint: 'unknown', hadBom: false, eol: 'lf', rootShape: deriveRootShape(rootPaths, nodes) };

  const filePath = plan.baseFile ? sourceFile(plan.baseFile).filePath : 'merged-export.json';

  return { file: { filePath, rootIds: rootPaths, nodes, udtDefs, meta }, missingUdtDefs };
}

function deriveRootShape(rootPaths: string[], nodes: Map<string, TagNode>): TagFileMeta['rootShape'] {
  if (rootPaths.length > 1) return 'folder-array';
  const only = rootPaths[0] ? nodes.get(rootPaths[0]) : undefined;
  return only?.tagType === 'Provider' ? 'provider' : 'single-node';
}

/** Every UDT instance's `typeId` chain must resolve inside the merge result
 *  (or be explicitly acknowledged as already existing on the target
 *  gateway) -- otherwise the export breaks on import (PLAN.md §4.3). */
export function findMissingUdtDefs(file: TagFile): MissingUdtDef[] {
  const missing: MissingUdtDef[] = [];
  for (const [path, node] of file.nodes) {
    if (node.kind === 'udt-instance' && node.typeId && !file.udtDefs.has(node.typeId)) {
      missing.push({ instancePath: path, typeId: node.typeId });
    }
  }
  return missing;
}

/** Adds 'add' ops that pull in each missing UDT definition, preferring B's
 *  copy (the more "current" side in the common dev -> prod direction) and
 *  falling back to A's. Definitions already targeted by an op are skipped. */
export function pullInUdtDefs(fileA: TagFile, fileB: TagFile, plan: MergePlan, missing: readonly MissingUdtDef[]): MergePlan {
  const alignA = buildAlignmentIndex(fileA);
  const alignB = buildAlignmentIndex(fileB);
  const already = new Set(plan.ops.filter((o) => o.op === 'add' || o.op === 'replace').map((o) => o.path));
  const extraOps: MergeOp[] = [];

  for (const { typeId } of missing) {
    const bDefId = fileB.udtDefs.get(typeId);
    const aDefId = fileA.udtDefs.get(typeId);
    // NOT `bDefId ? ... : aDefId ? ...` — a def id could in principle be "".
    const side: MergeSide | null = bDefId !== undefined ? 'b' : aDefId !== undefined ? 'a' : null;
    if (!side) continue;
    const defId = side === 'b' ? bDefId! : aDefId!;
    const defAlignPath = (side === 'b' ? alignB : alignA).pathById.get(defId);
    if (!defAlignPath || already.has(defAlignPath)) continue;
    extraOps.push({ op: 'add', path: defAlignPath, from: side });
    already.add(defAlignPath);
  }

  return { ...plan, ops: [...plan.ops, ...extraOps] };
}
